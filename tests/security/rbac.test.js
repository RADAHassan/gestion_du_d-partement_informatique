const jwt = require('jsonwebtoken');
const { resetDb, loginAll, as, request, app, pool, idOf, close, at } = require('../helpers');

beforeAll(async () => {
  await resetDb();
  await loginAll('admin', 'prof1', 'prof2', 'etu1');
});
afterAll(close);

// Toutes les routes réservées au chef de département
const ADMIN_ROUTES = [
  ['get', '/api/admin/users'], ['post', '/api/admin/users'], ['put', '/api/admin/users/1'], ['delete', '/api/admin/users/1'],
  ['get', '/api/admin/cycles'], ['post', '/api/admin/cycles'], ['delete', '/api/admin/cycles/1'],
  ['get', '/api/admin/filieres'], ['post', '/api/admin/filieres'],
  ['get', '/api/admin/groupes'], ['post', '/api/admin/groupes'],
  ['get', '/api/admin/salles'], ['post', '/api/admin/salles'], ['put', '/api/admin/salles/1'], ['delete', '/api/admin/salles/1'],
  ['get', '/api/admin/equipements'], ['post', '/api/admin/equipements'], ['put', '/api/admin/equipements/1'],
  ['post', '/api/admin/equipements/1/mouvements'], ['get', '/api/admin/mouvements'], ['get', '/api/admin/alertes'],
  ['get', '/api/admin/seances'], ['post', '/api/admin/seances'],
  ['get', '/api/admin/demandes'], ['post', '/api/admin/demandes/1/valider'], ['post', '/api/admin/demandes/1/refuser'],
  ['post', '/api/admin/demandes/1/retour'],
  ['get', '/api/admin/justificatifs'], ['post', '/api/admin/justificatifs/1/valider'], ['post', '/api/admin/justificatifs/1/refuser'],
  ['get', '/api/admin/feuilles'], ['get', '/api/admin/stats'], ['get', '/api/admin/journal'],
];

describe('Routes Admin : 403 Forbidden pour étudiants et enseignants', () => {
  test.each(ADMIN_ROUTES)('%s %s', async (method, url) => {
    for (const who of ['etu1', 'prof1']) {
      const res = await as(who)[method](url).send({});
      expect({ who, status: res.status }).toEqual({ who, status: 403 });
    }
  });

  test.each(ADMIN_ROUTES)('%s %s sans jeton => 401', async (method, url) => {
    expect((await request(app)[method](url).send({})).status).toBe(401);
  });

  test('l\'admin y accède (200)', async () => {
    for (const url of ['/api/admin/users', '/api/admin/stats', '/api/admin/journal', '/api/admin/alertes']) {
      expect((await as('admin').get(url)).status).toBe(200);
    }
  });

  test('aucune donnée sensible n\'est exposée dans les réponses 403', async () => {
    const r = await as('etu1').get('/api/admin/users');
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash|@fsttanger/i);
  });

  test('l\'étudiant ne peut pas se promouvoir admin via l\'API', async () => {
    const me = (await pool.query("SELECT id FROM users WHERE email = 'etudiant1@etu.fsttanger.ma'")).rows[0].id;
    expect((await as('etu1').put(`/api/admin/users/${me}`).send({ role: 'admin' })).status).toBe(403);
    expect((await pool.query('SELECT role FROM users WHERE id = $1', [me])).rows[0].role).toBe('etudiant');
  });
});

describe('Routes réservées aux enseignants / étudiants', () => {
  test('un étudiant ne peut ni réserver une salle, ni demander du matériel, ni ouvrir un pointage', async () => {
    expect((await as('etu1').post('/api/reservations').send({ salle_id: 1, debut: at(5), fin: at(5, 9) })).status).toBe(403);
    expect((await as('etu1').get('/api/reservations')).status).toBe(403);
    expect((await as('etu1').post('/api/materiel/demandes').send({ equipement_id: 1, quantite: 1 })).status).toBe(403);
    expect((await as('etu1').get('/api/materiel')).status).toBe(403);
    expect((await as('etu1').post('/api/seances/1/pointage/ouvrir')).status).toBe(403);
    expect((await as('etu1').post('/api/seances/1/valider')).status).toBe(403);
    expect((await as('etu1').post('/api/seances/1/annuler')).status).toBe(403);
    expect((await as('etu1').put('/api/seances/1/presences/1').send({ statut: 'present' })).status).toBe(403);
  });

  test('un enseignant ne peut pas utiliser l\'espace étudiant (pointer, justifier)', async () => {
    expect((await as('prof1').post('/api/etudiant/pointage').send({ code: 'ABCDEF' })).status).toBe(403);
    expect((await as('prof1').get('/api/etudiant/absences/mes')).status).toBe(403);
    expect((await as('prof1').post('/api/etudiant/absences/1/justificatif')).status).toBe(403);
  });

  test('l\'admin ne peut pas ouvrir un pointage (réservé à l\'enseignant)', async () => {
    expect((await as('admin').post('/api/seances/1/pointage/ouvrir')).status).toBe(403);
  });

  test('un enseignant ne peut pas agir sur la séance d\'un collègue (403)', async () => {
    const id = await idOf("SELECT id FROM seances WHERE module = 'Bases de données'"); // prof2
    expect((await as('prof1').post(`/api/seances/${id}/pointage/ouvrir`)).status).toBe(403);
    expect((await as('prof1').get(`/api/seances/${id}/pointage`)).status).toBe(403);
    expect((await as('prof1').post(`/api/seances/${id}/valider`)).status).toBe(403);
  });

  test('un étudiant ne voit pas les emplois du temps des autres groupes', async () => {
    const g1 = await idOf("SELECT groupe_id AS id FROM users WHERE email = 'etudiant1@etu.fsttanger.ma'");
    const list = (await as('etu1').get('/api/seances/mes')).body;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((s) => s.groupe_id === g1)).toBe(true);
  });
});

describe('Jetons JWT', () => {
  const secret = process.env.JWT_SECRET;
  const userId = () => idOf("SELECT id FROM users WHERE email = 'etudiant1@etu.fsttanger.ma'");
  const get = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

  test('jeton signé avec un mauvais secret => 401', async () => {
    expect((await get(jwt.sign({ sub: await userId(), role: 'admin' }, 'autre-secret'))).status).toBe(401);
  });

  test('jeton "alg: none" => 401', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 1, role: 'admin' })}.`;
    expect((await get(forged)).status).toBe(401);
  });

  test('jeton expiré => 401', async () => {
    expect((await get(jwt.sign({ sub: await userId(), role: 'etudiant' }, secret, { expiresIn: -10 }))).status).toBe(401);
  });

  test('le rôle du jeton est ignoré : un étudiant avec un jeton "admin" reste étudiant (403)', async () => {
    const t = jwt.sign({ sub: await userId(), role: 'admin' }, secret, { expiresIn: '1h' });
    expect((await get(t)).body.user.role).toBe('etudiant');
    expect((await request(app).get('/api/admin/users').set('Authorization', `Bearer ${t}`)).status).toBe(403);
  });

  test('en-têtes malformés => 401', async () => {
    for (const h of ['', 'Bearer', 'Bearer ', 'Basic abc', 'Bearer a.b.c', 'bearer-token']) {
      expect((await request(app).get('/api/auth/me').set('Authorization', h)).status).toBe(401);
    }
  });

  test('un compte désactivé perd immédiatement l\'accès (jeton encore valide)', async () => {
    const t = as('prof2').token;
    expect((await get(t)).status).toBe(200);
    await pool.query("UPDATE users SET actif = FALSE WHERE email = 'prof2@fsttanger.ma'");
    expect((await get(t)).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: 'prof2@fsttanger.ma', password: 'Prof@1234' });
    expect(login.status).toBe(401);
    await pool.query("UPDATE users SET actif = TRUE WHERE email = 'prof2@fsttanger.ma'");
  });
});
