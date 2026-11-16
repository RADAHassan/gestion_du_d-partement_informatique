const { resetDb, loginAll, as, at, idOf, pool, close, request, app } = require('../helpers');

let salle; let g1; let g2; let prof1;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);

beforeAll(async () => {
  await resetDb();
  await loginAll('admin', 'prof1', 'prof2', 'etu1', 'etu2', 'etu3', 'etu4', 'etu5');
  prof1 = await idOf("SELECT id FROM users WHERE email = 'prof1@fsttanger.ma'");
  g1 = await idOf("SELECT g.id FROM groupes g JOIN filieres f ON f.id=g.filiere_id WHERE f.nom='LST Informatique' AND g.nom='G1'");
  g2 = await idOf("SELECT g.id FROM groupes g JOIN filieres f ON f.id=g.filiere_id WHERE f.nom='LST Informatique' AND g.nom='G2'");
  salle = (await as('admin').post('/api/admin/salles').send({ nom: 'Salle P', capacite: 40 })).body.id;
});
afterAll(close);

let nextDay = 50;
/** Crée une séance de prof1 pour le groupe donné et retourne son id. */
async function newSeance(groupe = g1) {
  nextDay += 1;
  const r = await as('admin').post('/api/admin/seances').send({
    module: 'Pointage test', enseignant_id: prof1, groupe_id: groupe, salle_id: salle, debut: at(nextDay, 8), fin: at(nextDay, 10),
  });
  expect(r.status).toBe(201);
  return r.body.id;
}
const ouvrir = (id, extra = {}) => as('prof1').post(`/api/seances/${id}/pointage/ouvrir`).send(extra);
const presenceOf = async (seance, email) => (await pool.query(
  `SELECT p.statut, p.source FROM presences p JOIN users u ON u.id = p.etudiant_id WHERE p.seance_id = $1 AND u.email = $2`,
  [seance, email])).rows[0];

describe('Ouverture du pointage', () => {
  test('génère un code temporaire (6 car.) valable 15 min par défaut', async () => {
    const id = await newSeance();
    const r = await ouvrir(id);
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^[A-Z2-9]{6}$/);
    const minutes = (new Date(r.body.expire_le) - new Date(r.body.ouvert_le)) / 60000;
    expect(Math.round(minutes)).toBe(15);
    expect(r.body.statut).toBe('ouvert');
  });

  test('double ouverture => 409 ; durée personnalisée bornée', async () => {
    const id = await newSeance();
    expect((await ouvrir(id, { duree_minutes: 5 })).status).toBe(201);
    expect((await ouvrir(id)).status).toBe(409);
    const id2 = await newSeance();
    expect((await ouvrir(id2, { duree_minutes: 600 })).status).toBe(400);
  });

  test('séance d\'un collègue => 403 ; séance inconnue => 404', async () => {
    const id = await newSeance();
    expect((await as('prof2').post(`/api/seances/${id}/pointage/ouvrir`)).status).toBe(403);
    expect((await ouvrir(999999)).status).toBe(404);
  });

  test('impossible sur une séance annulée', async () => {
    const id = await newSeance();
    await as('prof1').post(`/api/seances/${id}/annuler`);
    expect((await ouvrir(id)).status).toBe(409);
  });
});

describe('Pointage étudiant, clôture et calcul des absences', () => {
  let seance; let code;
  beforeAll(async () => {
    seance = await newSeance(g1); // G1 = étudiants 1 à 4
    code = (await ouvrir(seance)).body.code;
  });

  test('un étudiant du groupe pointe avec le code (insensible à la casse)', async () => {
    const r = await as('etu1').post('/api/etudiant/pointage').send({ code: code.toLowerCase() });
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe('present');
    expect((await presenceOf(seance, 'etudiant1@etu.fsttanger.ma')).source).toBe('etudiant');
  });

  test('re-pointer est idempotent (200)', async () => {
    expect((await as('etu1').post('/api/etudiant/pointage').send({ code })).status).toBe(200);
  });

  test('code erroné => 404 ; étudiant d\'un autre groupe => 404', async () => {
    expect((await as('etu3').post('/api/etudiant/pointage').send({ code: 'ZZZZZZ' })).status).toBe(404);
    expect((await as('etu5').post('/api/etudiant/pointage').send({ code })).status).toBe(404); // G2
    expect(await presenceOf(seance, 'etudiant5@etu.fsttanger.ma')).toBeUndefined();
  });

  test('l\'enseignant voit les présents en direct', async () => {
    await as('etu3').post('/api/etudiant/pointage').send({ code });
    const r = await as('prof1').get(`/api/seances/${seance}/pointage`);
    expect(r.status).toBe(200);
    expect(r.body.pointage.statut).toBe('ouvert');
    expect(r.body.pointage.secondes_restantes).toBeGreaterThan(800);
    const statuts = Object.fromEntries(r.body.etudiants.map((e) => [e.nom, e.statut]));
    expect(statuts.Amrani).toBe('present');
    expect(statuts.Chraibi).toBe('present');
    expect(statuts.Bennis).toBeNull(); // pas encore pointé
  });

  test('clôture : les non-pointés (étudiants 2 et 4) deviennent absents automatiquement', async () => {
    const r = await as('prof1').post(`/api/seances/${seance}/pointage/fermer`);
    expect(r.status).toBe(200);
    const statuts = Object.fromEntries(r.body.etudiants.map((e) => [e.nom, e.statut]));
    expect(statuts).toEqual({ Amrani: 'present', Bennis: 'absent', Chraibi: 'present', Daoudi: 'absent' });
    expect((await presenceOf(seance, 'etudiant2@etu.fsttanger.ma')).source).toBe('auto');
    // l'étudiant d'un autre groupe n'est pas marqué absent
    expect(await presenceOf(seance, 'etudiant5@etu.fsttanger.ma')).toBeUndefined();
  });

  test('après clôture, le code n\'est plus accepté', async () => {
    const r = await as('etu2').post('/api/etudiant/pointage').send({ code });
    expect(r.status).toBe(404);
    expect((await presenceOf(seance, 'etudiant2@etu.fsttanger.ma')).statut).toBe('absent');
  });

  test('fermer deux fois => 409', async () => {
    expect((await as('prof1').post(`/api/seances/${seance}/pointage/fermer`)).status).toBe(409);
  });

  test('correction manuelle de secours (étudiant 2 : absent -> présent)', async () => {
    const r = await as('prof1').put(`/api/seances/${seance}/presences/${await idOf("SELECT id FROM users WHERE email='etudiant2@etu.fsttanger.ma'")}`)
      .send({ statut: 'present' });
    expect(r.status).toBe(200);
    expect((await presenceOf(seance, 'etudiant2@etu.fsttanger.ma'))).toEqual({ statut: 'present', source: 'manuel' });
  });

  test('correction refusée pour un étudiant hors groupe (400) ou statut invalide (400)', async () => {
    const e5 = await idOf("SELECT id FROM users WHERE email='etudiant5@etu.fsttanger.ma'");
    expect((await as('prof1').put(`/api/seances/${seance}/presences/${e5}`).send({ statut: 'present' })).status).toBe(400);
    const e4 = await idOf("SELECT id FROM users WHERE email='etudiant4@etu.fsttanger.ma'");
    expect((await as('prof1').put(`/api/seances/${seance}/presences/${e4}`).send({ statut: 'absent_justifie' })).status).toBe(400);
  });

  test('validation de la feuille => transmise au chef de département', async () => {
    const r = await as('prof1').post(`/api/seances/${seance}/valider`);
    expect(r.status).toBe(200);
    expect(r.body.seance.presence_validee).toBe(true);
    const feuilles = (await as('admin').get('/api/admin/feuilles')).body;
    const f = feuilles.find((x) => x.id === seance);
    expect(f).toMatchObject({ presents: 3, absents: 1, justifies: 0 });
  });

  test('après validation : plus de correction ni de nouvelle validation (409)', async () => {
    const e4 = await idOf("SELECT id FROM users WHERE email='etudiant4@etu.fsttanger.ma'");
    expect((await as('prof1').put(`/api/seances/${seance}/presences/${e4}`).send({ statut: 'present' })).status).toBe(409);
    expect((await as('prof1').post(`/api/seances/${seance}/valider`)).status).toBe(409);
  });
});

describe('Clôture automatique à l\'expiration du code', () => {
  test('code expiré refusé et absents calculés sans action de l\'enseignant', async () => {
    const seance = await newSeance(g1);
    const code = (await ouvrir(seance, { duree_minutes: 1 })).body.code;
    await as('etu1').post('/api/etudiant/pointage').send({ code });
    // simule l'écoulement du délai
    await pool.query("UPDATE pointages SET expire_le = now() - interval '1 second' WHERE seance_id = $1", [seance]);

    const late = await as('etu2').post('/api/etudiant/pointage').send({ code });
    expect(late.status).toBe(404);

    const p = (await pool.query('SELECT statut FROM pointages WHERE seance_id = $1', [seance])).rows[0];
    expect(p.statut).toBe('cloture');
    expect((await presenceOf(seance, 'etudiant1@etu.fsttanger.ma')).statut).toBe('present');
    for (const n of [2, 3, 4]) expect((await presenceOf(seance, `etudiant${n}@etu.fsttanger.ma`)).statut).toBe('absent');
  });

  test('validation sans pointage => 409 ; validation pendant un pointage ouvert le clôture', async () => {
    const s1 = await newSeance(g1);
    expect((await as('prof1').post(`/api/seances/${s1}/valider`)).status).toBe(409);
    const s2 = await newSeance(g1);
    await ouvrir(s2);
    expect((await as('prof1').post(`/api/seances/${s2}/valider`)).status).toBe(200);
    expect((await presenceOf(s2, 'etudiant4@etu.fsttanger.ma')).statut).toBe('absent');
  });
});

describe('Absences & justificatifs', () => {
  let seance; let presenceId;
  const send = (who, id, file, name, type, motif = 'Certificat médical') =>
    as(who).post(`/api/etudiant/absences/${id}/justificatif`).field('motif', motif).attach('fichier', file, { filename: name, contentType: type });

  beforeAll(async () => {
    seance = await newSeance(g1);
    await ouvrir(seance);
    await as('prof1').post(`/api/seances/${seance}/pointage/fermer`);
    presenceId = (await pool.query(
      "SELECT p.id FROM presences p JOIN users u ON u.id = p.etudiant_id WHERE p.seance_id = $1 AND u.email = 'etudiant2@etu.fsttanger.ma'", [seance])).rows[0].id;
  });

  test('l\'étudiant consulte ses absences et leur statut', async () => {
    const r = await as('etu2').get('/api/etudiant/absences/mes');
    expect(r.status).toBe(200);
    expect(r.body.find((a) => a.id === presenceId).statut).toBe('absent');
  });

  test('type non autorisé => 415 ; contenu falsifié (faux PDF) => 415 ; pas de fichier => 400', async () => {
    expect((await send('etu2', presenceId, Buffer.from('MZ binaire'), 'virus.exe', 'application/x-msdownload')).status).toBe(415);
    expect((await send('etu2', presenceId, Buffer.from('<script>alert(1)</script>'), 'faux.pdf', 'application/pdf')).status).toBe(415);
    expect((await as('etu2').post(`/api/etudiant/absences/${presenceId}/justificatif`).field('motif', 'x')).status).toBe(400);
  });

  test('un étudiant ne peut pas justifier l\'absence d\'un autre (404)', async () => {
    expect((await send('etu1', presenceId, PDF, 'a.pdf', 'application/pdf')).status).toBe(404);
  });

  test('dépôt PDF valide => en attente', async () => {
    const r = await send('etu2', presenceId, PDF, 'certificat.pdf', 'application/pdf');
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe('en_attente');
    const again = await send('etu2', presenceId, PNG, 'autre.png', 'image/png');
    expect(again.status).toBe(409); // déjà un justificatif en cours
  });

  test('l\'admin liste, télécharge puis valide : absence => absent_justifie', async () => {
    const list = (await as('admin').get('/api/admin/justificatifs').query({ statut: 'en_attente' })).body;
    expect(list).toHaveLength(1);
    const jid = list[0].id;
    const file = await as('admin').get(`/api/justificatifs/${jid}/fichier`);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/attachment/);

    const ok = await as('admin').post(`/api/admin/justificatifs/${jid}/valider`).send({ commentaire: 'OK' });
    expect(ok.status).toBe(200);
    expect((await presenceOf(seance, 'etudiant2@etu.fsttanger.ma')).statut).toBe('absent_justifie');
    expect((await as('admin').post(`/api/admin/justificatifs/${jid}/valider`)).status).toBe(409);

    const mine = (await as('etu2').get('/api/etudiant/absences/mes')).body.find((a) => a.id === presenceId);
    expect(mine.statut).toBe('absent_justifie');
    expect(mine.justificatif_statut).toBe('valide');
  });

  test('seul le propriétaire ou l\'admin télécharge un justificatif (403 sinon)', async () => {
    const jid = (await pool.query('SELECT id FROM justificatifs LIMIT 1')).rows[0].id;
    expect((await as('etu1').get(`/api/justificatifs/${jid}/fichier`)).status).toBe(403);
    expect((await as('prof1').get(`/api/justificatifs/${jid}/fichier`)).status).toBe(403);
    expect((await as('etu2').get(`/api/justificatifs/${jid}/fichier`)).status).toBe(200);
    expect((await request(app).get(`/api/justificatifs/${jid}/fichier`)).status).toBe(401);
  });

  test('justificatif refusé : l\'étudiant peut en redéposer un (image PNG)', async () => {
    const s = await newSeance(g1);
    await ouvrir(s);
    await as('prof1').post(`/api/seances/${s}/pointage/fermer`);
    const pid = (await pool.query(
      "SELECT p.id FROM presences p JOIN users u ON u.id = p.etudiant_id WHERE p.seance_id = $1 AND u.email = 'etudiant3@etu.fsttanger.ma'", [s])).rows[0].id;
    const dep = await send('etu3', pid, PNG, 'scan.png', 'image/png');
    expect(dep.status).toBe(201);
    expect((await as('admin').post(`/api/admin/justificatifs/${dep.body.id}/refuser`).send({ commentaire: 'Illisible' })).status).toBe(200);
    expect((await presenceOf(s, 'etudiant3@etu.fsttanger.ma')).statut).toBe('absent');
    expect((await send('etu3', pid, PDF, 'nouveau.pdf', 'application/pdf')).status).toBe(201);
  });
});

describe('Emploi du temps par rôle', () => {
  test('étudiant : uniquement les séances de son groupe ; enseignant : les siennes ; admin : tout', async () => {
    const etu = (await as('etu5').get('/api/seances/mes')).body; // G2
    expect(etu.length).toBeGreaterThan(0);
    expect(etu.every((s) => s.groupe_id === g2)).toBe(true);
    const prof = (await as('prof1').get('/api/seances/mes')).body;
    expect(prof.every((s) => s.enseignant_id === prof1)).toBe(true);
    const all = (await as('admin').get('/api/seances/mes')).body;
    expect(all.length).toBeGreaterThan(prof.length);
  });
});
