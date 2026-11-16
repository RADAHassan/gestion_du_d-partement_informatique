/** Sécurité des nouvelles routes : authentification, RBAC (403), IDOR, injection SQL, XSS stocké, CSRF. */
const { resetDb, loginAll, as, idOf, pool, close, request, app } = require('../helpers');

let salle;
beforeAll(async () => {
  await resetDb();
  await loginAll('admin', 'prof1', 'etu1', 'etu2');
  salle = await idOf("SELECT id FROM salles WHERE nom = 'Salle 101'");
});
afterAll(close);

const EVIL = 'https://evil.example';

describe('Authentification obligatoire (401 sans jeton)', () => {
  const routes = [
    ['get', '/api/notifications'], ['get', '/api/notifications/non-lues'], ['post', '/api/notifications/lues'],
    ['post', '/api/notifications/1/lue'], ['get', '/api/parametres'], ['put', '/api/parametres'],
    ['get', '/api/pannes'], ['post', '/api/pannes'], ['post', '/api/pannes/1/resoudre'],
    ['get', '/api/stats/absences'], ['get', '/api/stats/absences/export'],
  ];
  test.each(routes)('%s %s', async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
  });

  test('jeton falsifié => 401', async () => {
    const r = await request(app).get('/api/notifications').set('Authorization', 'Bearer abc.def.ghi');
    expect(r.status).toBe(401);
  });
});

describe('RBAC strict côté serveur (403)', () => {
  test.each([['prof1'], ['etu1']])('%s ne peut pas modifier les paramètres', async (who) => {
    expect((await as(who).put('/api/parametres').send({ retard_minutes: 1 })).status).toBe(403);
  });
  test.each([['prof1'], ['etu1']])('%s ne peut pas résoudre une panne', async (who) => {
    expect((await as(who).post('/api/pannes/1/resoudre')).status).toBe(403);
  });
  test('un étudiant n\'accède ni aux statistiques ni à l\'export', async () => {
    expect((await as('etu1').get('/api/stats/absences')).status).toBe(403);
    expect((await as('etu1').get('/api/stats/absences/export')).status).toBe(403);
  });
  test('les paramètres ne changent pas après une tentative refusée', async () => {
    const v = (await pool.query("SELECT valeur FROM parametres WHERE cle = 'retard_minutes'")).rows[0].valeur;
    expect(v).toBe('5');
  });
});

describe('IDOR : notifications strictement personnelles', () => {
  test('lire, marquer ou compter les notifications d\'un autre est impossible', async () => {
    const adminNotif = (await as('admin').get('/api/notifications')).body[0];
    expect(adminNotif).toBeDefined();
    expect((await as('etu1').post(`/api/notifications/${adminNotif.id}/lue`)).status).toBe(404);
    expect((await pool.query('SELECT lu FROM notifications WHERE id = $1', [adminNotif.id])).rows[0].lu).toBe(false);
    expect((await as('etu1').get('/api/notifications')).body.some((n) => n.id === adminNotif.id)).toBe(false);
  });

  test('« tout marquer comme lu » n\'affecte que le compte appelant', async () => {
    const before = (await as('admin').get('/api/notifications/non-lues')).body.non_lues;
    await as('etu1').post('/api/notifications/lues');
    expect((await as('admin').get('/api/notifications/non-lues')).body.non_lues).toBe(before);
  });
});

describe('Injection SQL', () => {
  const PAYLOADS = ["1 OR 1=1", "1; DROP TABLE users;--", "' OR '1'='1", "1) UNION SELECT password_hash FROM users--"];

  test.each(PAYLOADS)('filtres de statistiques : %s => 400, rien d\'exécuté', async (p) => {
    expect((await as('admin').get('/api/stats/absences').query({ groupe_id: p })).status).toBe(400);
    // une date : soit refusée (400), soit lue comme une vraie date puis passée en paramètre SQL (jamais concaténée)
    const d = await as('admin').get('/api/stats/absences').query({ from: p });
    expect([200, 400]).toContain(d.status);
    if (d.status === 200) expect(Array.isArray(d.body)).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBeGreaterThan(5);
    expect((await as('admin').get('/api/pannes').query({ statut: p })).status).toBe(400);
    expect((await as('admin').get('/api/notifications').query({ limit: p })).status).toBe(400);
    expect((await as('admin').post(`/api/notifications/${encodeURIComponent(p)}/lue`)).status).toBe(400);
  });

  test('description de panne : la charge utile est stockée comme simple texte', async () => {
    const payload = "x'); DROP TABLE users;--";
    const r = await as('etu1').post('/api/pannes').send({ salle_id: salle, description: payload });
    expect(r.status).toBe(201);
    expect(r.body.description).toBe(payload);
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBeGreaterThan(5);
  });

  test('paramètres : valeur injectée refusée (400)', async () => {
    expect((await as('admin').put('/api/parametres').send({ retard_minutes: '5; DROP TABLE parametres' })).status).toBe(400);
    expect((await as('admin').put('/api/parametres').send({ 'retard_minutes\'--': 5 })).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM parametres')).rows[0].n).toBe(3);
  });
});

describe('XSS stocké', () => {
  test('balises supprimées de la description d\'une panne (et donc des notifications)', async () => {
    const r = await as('etu2').post('/api/pannes').send({ salle_id: salle, description: '<script>alert(1)</script><img src=x onerror=alert(2)>Prise cassée' });
    expect(r.status).toBe(201);
    expect(r.body.description).toBe('Prise cassée');
    const all = JSON.stringify((await as('admin').get('/api/notifications')).body) + JSON.stringify((await as('admin').get('/api/pannes')).body);
    expect(all).not.toMatch(/<script|onerror/i);
  });

  test('commentaire de refus de justificatif nettoyé avant d\'être notifié', async () => {
    const eq = await pool.query("SELECT id FROM users WHERE email='etudiant1@etu.fsttanger.ma'");
    const seance = await pool.query("SELECT id FROM seances WHERE module = 'Algorithmique (hier)'");
    const p = await pool.query(
      `INSERT INTO presences (seance_id, etudiant_id, statut, source) VALUES ($1,$2,'absent','auto')
       ON CONFLICT (seance_id, etudiant_id) DO UPDATE SET statut = 'absent' RETURNING id`, [seance.rows[0].id, eq.rows[0].id]);
    const j = await pool.query(
      `INSERT INTO justificatifs (presence_id, etudiant_id, fichier, nom_original, mime) VALUES ($1,$2,'x.pdf','x.pdf','application/pdf') RETURNING id`,
      [p.rows[0].id, eq.rows[0].id]);
    await as('admin').post(`/api/admin/justificatifs/${j.rows[0].id}/refuser`).send({ commentaire: '<b onmouseover=alert(1)>Non</b> valable' });
    const msgs = (await as('etu1').get('/api/notifications')).body.map((n) => n.message).join('|');
    expect(msgs).toMatch(/refusé : Non valable/);
    expect(msgs).not.toMatch(/[<>]|onmouseover/);
  });
});

describe('CSRF', () => {
  test('requêtes modifiantes depuis une origine inconnue => 403, sans effet', async () => {
    const r = await as('admin').put('/api/parametres').set('Origin', EVIL).send({ retard_minutes: 1 });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/CSRF/);
    expect((await pool.query("SELECT valeur FROM parametres WHERE cle='retard_minutes'")).rows[0].valeur).toBe('5');

    expect((await as('etu1').post('/api/pannes').set('Origin', EVIL).send({ salle_id: salle, description: 'x' })).status).toBe(403);
    expect((await as('admin').post('/api/notifications/lues').set('Origin', EVIL)).status).toBe(403);
    expect((await as('admin').post('/api/pannes/1/resoudre').set('Origin', EVIL)).status).toBe(403);
  });

  test('un cookie ne suffit jamais à s\'authentifier', async () => {
    const t = as('admin').token;
    const r = await request(app).get('/api/notifications').set('Cookie', [`token=${t}`, `jwt=${t}`]);
    expect(r.status).toBe(401);
  });
});

describe('Export CSV', () => {
  test('l\'export est tracé dans le journal d\'activité', async () => {
    await as('admin').get('/api/stats/absences/export');
    const n = (await pool.query("SELECT count(*)::int AS n FROM journal WHERE action = 'stats.export'")).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  test('en-têtes de téléchargement (pas d\'affichage inline du CSV)', async () => {
    const r = await as('prof1').get('/api/stats/absences/export');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
