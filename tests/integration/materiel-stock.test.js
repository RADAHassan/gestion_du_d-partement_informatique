const { resetDb, loginAll, as, at, idOf, pool, close } = require('../helpers');

let projo; let cartouche; let papier;

beforeAll(async () => {
  await resetDb();
  await loginAll('admin', 'prof1', 'prof2', 'etu1');
  projo = await idOf("SELECT id FROM equipements WHERE nom = 'Vidéoprojecteur portable'"); // 2 unités (1 déjà réservée demain 8h-10h)
  cartouche = await idOf("SELECT id FROM equipements WHERE nom = 'Cartouche d''encre'");    // stock 8, seuil 3
  papier = await idOf("SELECT id FROM equipements WHERE nom = 'Ramette papier A4'");        // stock 20, seuil 5
});
afterAll(close);

const demande = (who, equipement_id, quantite, d, h1, h2) =>
  as(who).post('/api/materiel/demandes').send({ equipement_id, quantite, debut: at(d, h1), fin: at(d, h2), motif: 'test' });
const valider = (id) => as('admin').post(`/api/admin/demandes/${id}/valider`);

describe('Matériel durable : pas de double réservation', () => {
  test('demande + validation, puis la quantité restante diminue', async () => {
    const d = await demande('prof1', projo, 1, 15, 8, 10);
    expect(d.status).toBe(201);
    expect(d.body.statut).toBe('en_attente');
    expect((await valider(d.body.id)).body.statut).toBe('validee');
    const dispo = await as('prof2').get('/api/materiel').query({ debut: at(15, 9), fin: at(15, 9.5) });
    expect(dispo.body.find((e) => e.id === projo).disponible).toBe(1);
  });

  test('demande dépassant la quantité disponible => 409', async () => {
    const r = await demande('prof2', projo, 2, 15, 9, 10);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/indisponible/i);
  });

  test('la dernière unité peut être réservée, puis plus aucune', async () => {
    const d = await demande('prof2', projo, 1, 15, 9, 10);
    expect(d.status).toBe(201);
    expect((await valider(d.body.id)).status).toBe(200);
    expect((await demande('prof1', projo, 1, 15, 8, 10)).status).toBe(409);
  });

  test('un créneau sans chevauchement reste disponible', async () => {
    expect((await demande('prof1', projo, 2, 16, 8, 10)).status).toBe(201);
  });

  test('deux demandes en attente concurrentes : la 2e validation est refusée (409)', async () => {
    const a = await demande('prof1', projo, 2, 17, 8, 10);
    const b = await demande('prof2', projo, 1, 17, 9, 11);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect((await valider(a.body.id)).status).toBe(200);
    expect((await valider(b.body.id)).status).toBe(409);
  });

  test('validations simultanées : jamais de sur-réservation', async () => {
    const a = await demande('prof1', projo, 2, 18, 8, 10);
    const b = await demande('prof2', projo, 2, 18, 8, 10);
    const res = await Promise.all([valider(a.body.id), valider(b.body.id)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  test('le retour du matériel le rend de nouveau disponible', async () => {
    const d = await demande('prof1', projo, 2, 19, 8, 10);
    await valider(d.body.id);
    expect((await demande('prof2', projo, 1, 19, 8, 10)).status).toBe(409);
    expect((await as('admin').post(`/api/admin/demandes/${d.body.id}/retour`)).body.statut).toBe('retournee');
    expect((await demande('prof2', projo, 1, 19, 8, 10)).status).toBe(201);
  });

  test("l'annulation d'une demande validée libère le matériel", async () => {
    const d = await demande('prof1', projo, 2, 21, 8, 10);
    await valider(d.body.id);
    expect((await as('prof1').delete(`/api/materiel/demandes/${d.body.id}`)).body.statut).toBe('annulee');
    expect((await demande('prof2', projo, 2, 21, 8, 10)).status).toBe(201);
  });

  test("un enseignant ne peut pas annuler la demande d'un autre (403) ni valider lui-même (403)", async () => {
    const d = await demande('prof1', projo, 1, 22, 8, 10);
    expect((await as('prof2').delete(`/api/materiel/demandes/${d.body.id}`)).status).toBe(403);
    expect((await as('prof1').post(`/api/admin/demandes/${d.body.id}/valider`)).status).toBe(403);
  });

  test('une demande déjà traitée ne peut pas l\'être deux fois', async () => {
    const d = await demande('prof1', projo, 1, 23, 8, 10);
    expect((await as('admin').post(`/api/admin/demandes/${d.body.id}/refuser`)).status).toBe(200);
    expect((await valider(d.body.id)).status).toBe(409);
  });
});

describe('Stock des consommables : mise à jour automatique & alertes', () => {
  const alertesActives = async () =>
    (await as('admin').get('/api/admin/alertes')).body.filter((a) => !a.resolue);
  const stock = async (id) => (await pool.query('SELECT quantite FROM equipements WHERE id = $1', [id])).rows[0].quantite;

  test('la validation d\'une demande décrémente le stock et journalise la sortie', async () => {
    const d = await as('prof1').post('/api/materiel/demandes').send({ equipement_id: papier, quantite: 4 });
    expect(d.status).toBe(201);
    expect((await valider(d.body.id)).status).toBe(200);
    expect(await stock(papier)).toBe(16);
    const mouvements = (await as('admin').get('/api/admin/mouvements')).body;
    expect(mouvements.find((m) => m.equipement === 'Ramette papier A4' && m.type === 'sortie' && m.quantite === 4)).toBeTruthy();
  });

  test('pas d\'alerte tant que le stock reste >= seuil', async () => {
    expect((await alertesActives()).find((a) => a.equipement === 'Ramette papier A4')).toBeUndefined();
  });

  test('passage sous le seuil minimal => alerte automatique', async () => {
    // cartouches : 8 -> 2 (seuil 3)
    const d = await as('prof1').post('/api/materiel/demandes').send({ equipement_id: cartouche, quantite: 6 });
    await valider(d.body.id);
    expect(await stock(cartouche)).toBe(2);
    const a = (await alertesActives()).find((x) => x.equipement === "Cartouche d'encre");
    expect(a).toBeTruthy();
    expect(a.quantite).toBe(2);
    expect(a.message).toMatch(/seuil minimal/i);
  });

  test('une seule alerte active par équipement même après plusieurs sorties', async () => {
    await as('admin').post(`/api/admin/equipements/${cartouche}/mouvements`).send({ type: 'sortie', quantite: 1, motif: 'casse' });
    const actives = (await alertesActives()).filter((x) => x.equipement === "Cartouche d'encre");
    expect(actives).toHaveLength(1);
    expect(actives[0].quantite).toBe(1);
  });

  test('une entrée de stock au-dessus du seuil résout l\'alerte', async () => {
    const r = await as('admin').post(`/api/admin/equipements/${cartouche}/mouvements`).send({ type: 'entree', quantite: 10, motif: 'réapprovisionnement' });
    expect(r.status).toBe(201);
    expect(await stock(cartouche)).toBe(11);
    expect((await alertesActives()).find((x) => x.equipement === "Cartouche d'encre")).toBeUndefined();
  });

  test('sortie supérieure au stock => 409 et stock inchangé', async () => {
    const before = await stock(cartouche);
    const r = await as('admin').post(`/api/admin/equipements/${cartouche}/mouvements`).send({ type: 'sortie', quantite: before + 1 });
    expect(r.status).toBe(409);
    expect(await stock(cartouche)).toBe(before);
  });

  test('demande de consommable supérieure au stock => 409', async () => {
    const r = await as('prof1').post('/api/materiel/demandes').send({ equipement_id: cartouche, quantite: 999 });
    expect(r.status).toBe(409);
  });

  test('l\'alerte initiale du jeu de données (clé USB 4 < 5) est présente', async () => {
    expect((await as('admin').get('/api/admin/alertes')).body.some((a) => a.equipement === 'Clé USB 32 Go' && !a.resolue)).toBe(true);
  });

  test('modifier manuellement le seuil / la quantité resynchronise l\'alerte', async () => {
    const r = await as('admin').put(`/api/admin/equipements/${papier}`).send({ seuil_min: 50 });
    expect(r.status).toBe(200);
    expect((await alertesActives()).some((a) => a.equipement === 'Ramette papier A4')).toBe(true);
    await as('admin').put(`/api/admin/equipements/${papier}`).send({ seuil_min: 5 });
    expect((await alertesActives()).some((a) => a.equipement === 'Ramette papier A4')).toBe(false);
  });

  test('quantités négatives ou nulles refusées', async () => {
    const r = await as('admin').post(`/api/admin/equipements/${papier}/mouvements`).send({ type: 'entree', quantite: -5 });
    expect(r.status).toBe(400);
    expect((await pool.query('SELECT 1 FROM equipements WHERE quantite < 0')).rowCount).toBe(0);
  });

  test('le stock est tracé dans le journal d\'activité', async () => {
    const j = (await as('admin').get('/api/admin/journal')).body;
    expect(j.some((e) => e.action === 'stock.entree')).toBe(true);
  });
});
