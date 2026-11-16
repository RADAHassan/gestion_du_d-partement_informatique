/** Notifications, paramètres, retard, seuil d'absences, retard de retour du matériel, pannes, statistiques et export. */
const path = require('path');
const { resetDb, loginAll, as, at, idOf, pool, close } = require('../helpers');

const { checkLateReturns } = require(path.resolve(__dirname, '..', '..', 'backend', 'src', 'services', 'pointage'));

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
let g1; let g2; let prof1; let salle; let salle2;

beforeAll(async () => {
  await resetDb();
  await loginAll('admin', 'prof1', 'prof2', 'etu1', 'etu2', 'etu3', 'etu4', 'etu5');
  prof1 = await idOf("SELECT id FROM users WHERE email = 'prof1@fsttanger.ma'");
  g1 = await idOf("SELECT g.id FROM groupes g JOIN filieres f ON f.id=g.filiere_id WHERE f.nom='LST Informatique' AND g.nom='G1'");
  g2 = await idOf("SELECT g.id FROM groupes g JOIN filieres f ON f.id=g.filiere_id WHERE f.nom='LST Informatique' AND g.nom='G2'");
  salle = await idOf("SELECT id FROM salles WHERE nom = 'Salle 101'");
  salle2 = await idOf("SELECT id FROM salles WHERE nom = 'Salle 102'");
});
afterAll(close);

const notifs = async (who) => (await as(who).get('/api/notifications')).body;
const has = async (who, re) => (await notifs(who)).some((n) => re.test(n.message));
const countMsg = async (who, re) => (await notifs(who)).filter((n) => re.test(n.message)).length;

let nextDay = 70;
async function newSeance(groupe = g1) {
  nextDay += 1;
  const r = await as('admin').post('/api/admin/seances').send({
    module: 'Transversal', enseignant_id: prof1, groupe_id: groupe, salle_id: salle, debut: at(nextDay, 8), fin: at(nextDay, 10),
  });
  expect(r.status).toBe(201);
  return r.body.id;
}
const ouvrir = (id, extra = {}) => as('prof1').post(`/api/seances/${id}/pointage/ouvrir`).send(extra);
const fermer = (id) => as('prof1').post(`/api/seances/${id}/pointage/fermer`);
const presence = async (seance, email) => (await pool.query(
  'SELECT p.id, p.statut FROM presences p JOIN users u ON u.id = p.etudiant_id WHERE p.seance_id = $1 AND u.email = $2',
  [seance, email])).rows[0];

describe('Notifications', () => {
  test('l\'alerte de stock initiale a été notifiée au chef de département (seed)', async () => {
    expect(await has('admin', /Stock sous le seuil minimal : Clé USB/)).toBe(true);
  });

  test('réservation de salle => le chef de département est notifié (SQ1)', async () => {
    const r = await as('prof1').post('/api/reservations').send({ salle_id: salle2, debut: at(60, 8), fin: at(60, 10), motif: 'Soutenance' });
    expect(r.status).toBe(201);
    expect(await has('admin', /Nouvelle réservation : Salle 102 .* par Benani Samira/)).toBe(true);
  });

  test('annulation d\'une séance => seuls les étudiants du groupe sont notifiés (SQ2)', async () => {
    const id = await newSeance(g1);
    expect((await as('prof1').post(`/api/seances/${id}/annuler`)).status).toBe(200);
    expect(await has('etu1', /Séance annulée : Transversal/)).toBe(true);
    expect(await has('etu4', /Séance annulée : Transversal/)).toBe(true);
    expect(await has('etu5', /Séance annulée : Transversal/)).toBe(false); // groupe G2
    expect(await has('prof2', /Séance annulée/)).toBe(false);
  });

  test('demande de matériel => admin notifié ; décision => enseignant notifié', async () => {
    const eq = await idOf("SELECT id FROM equipements WHERE nom = 'Câble HDMI'");
    const d = await as('prof2').post('/api/materiel/demandes').send({ equipement_id: eq, quantite: 1, debut: at(80, 8), fin: at(80, 10) });
    expect(d.status).toBe(201);
    expect(await has('admin', /Nouvelle demande de matériel : Câble HDMI ×1 par El Idrissi Youssef/)).toBe(true);
    expect((await as('admin').post(`/api/admin/demandes/${d.body.id}/valider`)).status).toBe(200);
    expect(await has('prof2', new RegExp(`demande de matériel #${d.body.id} .*validée`))).toBe(true);
    const d2 = await as('prof2').post('/api/materiel/demandes').send({ equipement_id: eq, quantite: 1, debut: at(81, 8), fin: at(81, 10) });
    await as('admin').post(`/api/admin/demandes/${d2.body.id}/refuser`);
    expect(await has('prof2', new RegExp(`demande de matériel #${d2.body.id} .*refusée`))).toBe(true);
  });

  test('stock sous le seuil => une seule notification par alerte', async () => {
    const eq = await idOf("SELECT id FROM equipements WHERE nom = 'Ramette papier A4'");
    const mv = (quantite) => as('admin').post(`/api/admin/equipements/${eq}/mouvements`).send({ type: 'sortie', quantite, motif: 'test' });
    expect((await mv(16)).status).toBe(201); // 20 -> 4 < 5 : alerte
    expect((await mv(1)).status).toBe(201);  // 4 -> 3 : même alerte
    expect(await countMsg('admin', /Stock sous le seuil minimal : Ramette/)).toBe(1);
  });

  test('compteur, lecture d\'une notification, tout marquer comme lu', async () => {
    const before = (await as('admin').get('/api/notifications/non-lues')).body.non_lues;
    expect(before).toBeGreaterThan(2);
    const first = (await notifs('admin'))[0];
    const one = await as('admin').post(`/api/notifications/${first.id}/lue`);
    expect(one.status).toBe(200);
    expect(one.body.lu).toBe(true);
    expect((await as('admin').get('/api/notifications/non-lues')).body.non_lues).toBe(before - 1);
    const all = await as('admin').post('/api/notifications/lues');
    expect(all.status).toBe(200);
    expect((await as('admin').get('/api/notifications/non-lues')).body.non_lues).toBe(0);
  });

  test('on ne peut pas marquer la notification d\'un autre comme lue (404) et on ne voit que les siennes', async () => {
    const adminNotif = (await notifs('admin'))[0];
    expect((await as('etu1').post(`/api/notifications/${adminNotif.id}/lue`)).status).toBe(404);
    expect((await notifs('etu1')).some((n) => n.id === adminNotif.id)).toBe(false);
    expect((await as('admin').post('/api/notifications/abc/lue')).status).toBe(400);
  });
});

describe('Paramètres', () => {
  test('lecture ouverte à tous les rôles connectés', async () => {
    const r = await as('etu1').get('/api/parametres');
    expect(r.status).toBe(200);
    expect(r.body.map((p) => p.cle).sort()).toEqual(['pointage_minutes', 'retard_minutes', 'seuil_absences']);
  });

  test('modification réservée au chef de département (403 sinon)', async () => {
    expect((await as('prof1').put('/api/parametres').send({ retard_minutes: 3 })).status).toBe(403);
    expect((await as('etu1').put('/api/parametres').send({ retard_minutes: 3 })).status).toBe(403);
  });

  test('validation : borne, type, clé inconnue, corps vide => 400', async () => {
    const put = (b) => as('admin').put('/api/parametres').send(b);
    expect((await put({ retard_minutes: 0 })).status).toBe(400);
    expect((await put({ pointage_minutes: 999 })).status).toBe(400);
    expect((await put({ seuil_absences: 'beaucoup' })).status).toBe(400);
    expect((await put({ inconnu: 1 })).status).toBe(400);
    expect((await put({})).status).toBe(400);
  });

  test('la durée du pointage par défaut suit le paramètre', async () => {
    expect((await as('admin').put('/api/parametres').send({ pointage_minutes: 10 })).status).toBe(200);
    const id = await newSeance();
    const r = await ouvrir(id);
    expect(Math.round((new Date(r.body.expire_le) - new Date(r.body.ouvert_le)) / 60000)).toBe(10);
    await fermer(id);
    await as('admin').put('/api/parametres').send({ pointage_minutes: 15 });
  });
});

describe('Statut « en retard »', () => {
  let seance; let code;
  beforeAll(async () => {
    await as('admin').put('/api/parametres').send({ retard_minutes: 5 });
    seance = await newSeance(g1);
    code = (await ouvrir(seance)).body.code;
  });

  test('pointage dans le délai => présent', async () => {
    const r = await as('etu2').post('/api/etudiant/pointage').send({ code });
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe('present');
  });

  test('pointage au-delà du délai de retard => retard (et re-pointer ne change rien)', async () => {
    await pool.query(
      "UPDATE pointages SET ouvert_le = now() - interval '6 minutes', expire_le = now() + interval '9 minutes' WHERE seance_id = $1", [seance]);
    const r = await as('etu1').post('/api/etudiant/pointage').send({ code });
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe('retard');
    const again = await as('etu1').post('/api/etudiant/pointage').send({ code });
    expect(again.status).toBe(200);
    expect(again.body.statut).toBe('retard');
    expect((await presence(seance, 'etudiant1@etu.fsttanger.ma')).statut).toBe('retard');
  });

  test('la feuille et le tableau du chef comptent les retards', async () => {
    await as('etu3').post('/api/etudiant/pointage').send({ code });
    const f = await fermer(seance);
    const statuts = Object.fromEntries(f.body.etudiants.map((e) => [e.nom, e.statut]));
    expect(statuts).toEqual({ Amrani: 'retard', Bennis: 'present', Chraibi: 'retard', Daoudi: 'absent' });
    const valid = await as('prof1').post(`/api/seances/${seance}/valider`);
    expect(valid.status).toBe(200);
    const feuille = (await as('admin').get('/api/admin/feuilles')).body.find((x) => x.id === seance);
    expect(feuille).toMatchObject({ presents: 1, retards: 2, absents: 1 });
    expect(await has('admin', /Feuille de présence transmise : Transversal \(G1\) par Benani Samira/)).toBe(true);
  });

  test('un retard n\'est pas une absence : pas de justificatif possible (409)', async () => {
    const p = await presence(seance, 'etudiant1@etu.fsttanger.ma');
    const r = await as('etu1').post(`/api/etudiant/absences/${p.id}/justificatif`)
      .field('motif', 'bus en retard').attach('fichier', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(409);
  });

  test('correction manuelle : « retard » accepté, statut inventé refusé (400)', async () => {
    const s = await newSeance(g1);
    await ouvrir(s);
    const e4 = await idOf("SELECT id FROM users WHERE email='etudiant4@etu.fsttanger.ma'");
    expect((await as('prof1').put(`/api/seances/${s}/presences/${e4}`).send({ statut: 'retard' })).status).toBe(200);
    expect((await presence(s, 'etudiant4@etu.fsttanger.ma')).statut).toBe('retard');
    expect((await as('prof1').put(`/api/seances/${s}/presences/${e4}`).send({ statut: 'en_vacances' })).status).toBe(400);
    await fermer(s);
  });
});

describe('Alerte de seuil d\'absences et notification des absents', () => {
  test('atteindre le seuil alerte le chef une seule fois ; l\'absent est notifié', async () => {
    // étudiant2 (Bennis Bilal) a déjà N absences non justifiées : on fixe le seuil à N + 1
    const n = Number((await pool.query(
      `SELECT count(*) FROM presences p JOIN users u ON u.id = p.etudiant_id
        WHERE u.email = 'etudiant2@etu.fsttanger.ma' AND p.statut = 'absent'`)).rows[0].count) + 1;
    await as('admin').put('/api/parametres').send({ seuil_absences: n });
    const abs1 = await countMsg('etu1', /Absence enregistrée/);
    const abs2 = await countMsg('etu2', /Absence enregistrée/);
    const s = await newSeance(g1);
    const code = (await ouvrir(s)).body.code;
    await as('etu1').post('/api/etudiant/pointage').send({ code });
    await fermer(s); // étudiants 2, 3, 4 absents => étudiant2 atteint exactement le seuil
    const re = new RegExp(`Seuil d'absences atteint : Bennis Bilal \\(${n} absences`);
    expect(await countMsg('admin', re)).toBe(1);
    expect(await countMsg('etu2', /Absence enregistrée/)).toBe(abs2 + 1);
    expect(await countMsg('etu1', /Absence enregistrée/)).toBe(abs1); // présent : pas de notification d'absence

    const s2 = await newSeance(g1); // absence suivante : le seuil est déjà dépassé, pas de nouvelle alerte
    await ouvrir(s2);
    await fermer(s2);
    expect(await countMsg('admin', re)).toBe(1);
    expect(await countMsg('admin', new RegExp(`Bennis Bilal \\(${n + 1} absences`))).toBe(0);
    await as('admin').put('/api/parametres').send({ seuil_absences: 3 });
  });

  test('justificatif décidé => l\'étudiant est notifié', async () => {
    const p = await pool.query(
      `SELECT p.id FROM presences p JOIN users u ON u.id = p.etudiant_id
        WHERE u.email = 'etudiant4@etu.fsttanger.ma' AND p.statut = 'absent' LIMIT 1`);
    const dep = await as('etu4').post(`/api/etudiant/absences/${p.rows[0].id}/justificatif`)
      .field('motif', 'Certificat').attach('fichier', PDF, { filename: 'c.pdf', contentType: 'application/pdf' });
    expect(dep.status).toBe(201);
    expect(await has('admin', /Nouveau justificatif d'absence déposé par Daoudi Driss/)).toBe(true);
    await as('admin').post(`/api/admin/justificatifs/${dep.body.id}/refuser`).send({ commentaire: 'Illisible' });
    expect(await has('etu4', /justificatif d'absence a été refusé : Illisible/)).toBe(true);
  });
});

describe('Alerte de retard de retour du matériel', () => {
  test('matériel validé non rendu après la fin de la période => une alerte, pas de doublon', async () => {
    await pool.query("UPDATE demandes_materiel SET debut = now() - interval '3 hours', fin = now() - interval '1 hour' WHERE statut = 'validee' AND enseignant_id = $1", [prof1]);
    expect(await checkLateReturns()).toBe(1);
    expect(await has('admin', /Retard de retour : Vidéoprojecteur portable ×1/)).toBe(true);
    expect(await has('prof1', /Merci de rendre Vidéoprojecteur portable ×1/)).toBe(true);
    expect(await checkLateReturns()).toBe(0);
  });

  test('matériel rendu => aucune alerte', async () => {
    const eq = await idOf("SELECT id FROM equipements WHERE nom = 'Ordinateur portable'");
    const d = await as('prof2').post('/api/materiel/demandes').send({ equipement_id: eq, quantite: 1, debut: at(90, 8), fin: at(90, 10) });
    await as('admin').post(`/api/admin/demandes/${d.body.id}/valider`);
    await as('admin').post(`/api/admin/demandes/${d.body.id}/retour`);
    await pool.query("UPDATE demandes_materiel SET debut = now() - interval '3 hours', fin = now() - interval '1 hour' WHERE id = $1", [d.body.id]);
    expect(await checkLateReturns()).toBe(0);
  });
});

describe('Pannes (signalement par tous les rôles)', () => {
  let panneId;

  test('un étudiant signale une salle en panne => chef notifié', async () => {
    const r = await as('etu1').post('/api/pannes').send({ salle_id: salle, description: 'Vidéoprojecteur HS' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ salle: 'Salle 101', statut: 'ouverte', signale_par: 'Amrani Aya' });
    panneId = r.body.id;
    expect(await has('admin', /Panne signalée : Salle 101 par Amrani Aya/)).toBe(true);
  });

  test('un enseignant signale un équipement', async () => {
    const eq = await idOf("SELECT id FROM equipements WHERE nom = 'Câble HDMI'");
    const r = await as('prof1').post('/api/pannes').send({ equipement_id: eq, description: 'Connecteur cassé' });
    expect(r.status).toBe(201);
    expect(r.body.equipement).toBe('Câble HDMI');
  });

  test('validation : cible manquante, cible inexistante, description vide => 400', async () => {
    expect((await as('etu1').post('/api/pannes').send({ description: 'x' })).status).toBe(400);
    expect((await as('etu1').post('/api/pannes').send({ salle_id: 999999, description: 'x' })).status).toBe(400);
    expect((await as('etu1').post('/api/pannes').send({ equipement_id: 999999, description: 'x' })).status).toBe(400);
    expect((await as('etu1').post('/api/pannes').send({ salle_id: salle })).status).toBe(400);
  });

  test('chacun ne voit que ses signalements ; le chef voit tout', async () => {
    const mine = (await as('etu1').get('/api/pannes')).body;
    expect(mine.map((p) => p.id)).toContain(panneId);
    expect((await as('etu2').get('/api/pannes')).body).toHaveLength(0);
    expect((await as('prof1').get('/api/pannes')).body.every((p) => p.signale_par === 'Benani Samira')).toBe(true);
    expect((await as('admin').get('/api/pannes')).body.length).toBeGreaterThanOrEqual(2);
    expect((await as('admin').get('/api/pannes').query({ statut: 'inconnu' })).status).toBe(400);
  });

  test('résolution réservée au chef (403 sinon) puis le signalant est notifié ; double résolution => 409', async () => {
    expect((await as('etu1').post(`/api/pannes/${panneId}/resoudre`)).status).toBe(403);
    expect((await as('prof1').post(`/api/pannes/${panneId}/resoudre`)).status).toBe(403);
    const r = await as('admin').post(`/api/pannes/${panneId}/resoudre`);
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('resolue');
    expect(await has('etu1', /signalement de panne \(Salle 101\) a été résolu/)).toBe(true);
    expect((await as('admin').post(`/api/pannes/${panneId}/resoudre`)).status).toBe(409);
    expect((await as('admin').post('/api/pannes/999999/resoudre')).status).toBe(404);
  });
});

describe('Statistiques d\'absentéisme et export', () => {
  test('le chef voit tout le département, trié par absences décroissantes', async () => {
    const r = await as('admin').get('/api/stats/absences');
    expect(r.status).toBe(200);
    const bennis = r.body.find((x) => x.nom === 'Bennis');
    expect(bennis).toMatchObject({ groupe: 'G1', filiere: 'LST Informatique' });
    expect(bennis.absents).toBeGreaterThanOrEqual(3);
    expect(bennis.taux_absence).toBe(Math.round((bennis.absents / bennis.total) * 1000) / 10);
    const absents = r.body.map((x) => x.absents);
    expect([...absents].sort((a, b) => b - a)).toEqual(absents);
  });

  test('un enseignant ne voit que les présences de ses propres séances', async () => {
    const p1 = (await as('prof1').get('/api/stats/absences')).body;
    expect(p1.length).toBeGreaterThan(0);
    expect((await as('prof2').get('/api/stats/absences')).body).toHaveLength(0); // aucune présence sur ses séances
  });

  test('filtres : groupe, période ; paramètres invalides => 400 ; étudiant => 403', async () => {
    expect((await as('admin').get('/api/stats/absences').query({ groupe_id: g2 })).body).toHaveLength(0);
    expect((await as('admin').get('/api/stats/absences').query({ groupe_id: g1 })).body.length).toBeGreaterThan(0);
    expect((await as('admin').get('/api/stats/absences').query({ from: at(300, 8) })).body).toHaveLength(0);
    expect((await as('admin').get('/api/stats/absences').query({ groupe_id: 'abc' })).status).toBe(400);
    expect((await as('admin').get('/api/stats/absences').query({ from: 'pas-une-date' })).status).toBe(400);
    expect((await as('etu1').get('/api/stats/absences')).status).toBe(403);
    expect((await as('etu1').get('/api/stats/absences/export')).status).toBe(403);
  });

  test('export CSV : en-têtes, BOM UTF-8, séparateur « ; », une ligne par étudiant', async () => {
    const r = await as('admin').get('/api/stats/absences/export').buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="absences.csv"/);
    const text = r.body.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('Nom;Prénom;Filière;Groupe;Séances;Présences;Retards;Absences;Absences justifiées;Taux d\'absence (%)');
    const api = (await as('admin').get('/api/stats/absences')).body;
    expect(lines).toHaveLength(api.length + 1);
    expect(lines.some((l) => l.startsWith('Bennis;Bilal;LST Informatique;G1;'))).toBe(true);
  });

  test('export : une cellule qui ressemble à une formule est neutralisée (injection CSV)', async () => {
    await pool.query("UPDATE users SET nom = '=HYPERLINK(\"http://evil\")' WHERE email = 'etudiant1@etu.fsttanger.ma'");
    const r = await as('admin').get('/api/stats/absences/export');
    const text = r.text || r.body.toString('utf8');
    expect(text).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(text).not.toMatch(/(^|;|\n)=HYPERLINK/);
    await pool.query("UPDATE users SET nom = 'Amrani' WHERE email = 'etudiant1@etu.fsttanger.ma'");
  });
});
