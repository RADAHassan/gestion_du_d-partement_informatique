const { resetDb, loginAll, as, at, idOf, pool, close, request, app } = require('../helpers');

let salle201; let salle202;

beforeAll(async () => {
  await resetDb();
  await loginAll('admin', 'prof1', 'prof2', 'etu1');
  salle201 = (await as('admin').post('/api/admin/salles').send({ nom: 'Salle 201', capacite: 30 })).body.id;
  salle202 = (await as('admin').post('/api/admin/salles').send({ nom: 'Salle 202', capacite: 30 })).body.id;
});
afterAll(close);

const resa = (who, salle, d, h1, h2, motif = 'Test') =>
  as(who).post('/api/reservations').send({ salle_id: salle, debut: at(d, h1), fin: at(d, h2), motif });

describe('Réservation de salles : détection de conflits', () => {
  test('un enseignant réserve une salle libre', async () => {
    const r = await resa('prof1', salle201, 10, 8, 10);
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe('active');
  });

  test('chevauchement => refus immédiat 409 avec le conflit détaillé', async () => {
    const r = await resa('prof2', salle201, 10, 9, 11);
    expect(r.status).toBe(409);
    expect(r.body.details.conflits).toHaveLength(1);
    expect(r.body.details.conflits[0].type).toBe('reservation');
  });

  test('créneau identique et créneau englobant sont refusés', async () => {
    expect((await resa('prof2', salle201, 10, 8, 10)).status).toBe(409);
    expect((await resa('prof2', salle201, 10, 7, 12)).status).toBe(409);
  });

  test('créneaux adjacents acceptés (10h-12h juste après 8h-10h)', async () => {
    expect((await resa('prof2', salle201, 10, 10, 12)).status).toBe(201);
  });

  test('une autre salle sur le même créneau reste réservable', async () => {
    expect((await resa('prof2', salle202, 10, 8, 10)).status).toBe(201);
  });

  test('refuse période invalide (fin <= début) et dates absurdes', async () => {
    expect((await resa('prof1', salle201, 11, 10, 9)).status).toBe(400);
    const r = await as('prof1').post('/api/reservations').send({ salle_id: salle201, debut: 'hier', fin: 'demain' });
    expect(r.status).toBe(400);
  });

  test('réservation sur un créneau occupé par une SÉANCE planifiée => 409', async () => {
    const { body } = await as('prof1').get('/api/seances/mes');
    const algo = body.find((s) => s.module === 'Algorithmique');
    const r = await as('prof2').post('/api/reservations')
      .send({ salle_id: algo.salle_id, debut: algo.debut, fin: algo.fin });
    expect(r.status).toBe(409);
    expect(r.body.details.conflits[0].type).toBe('seance');
  });

  test('concurrence : 6 demandes simultanées du même créneau => une seule réussit', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      resa(i % 2 ? 'prof1' : 'prof2', salle201, 20, 14, 16)));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    const n = await pool.query(
      "SELECT count(*)::int AS n FROM reservations WHERE salle_id = $1 AND statut = 'active' AND debut = $2", [salle201, at(20, 14)]);
    expect(n.rows[0].n).toBe(1);
  });

  test('contrainte d\'exclusion PostgreSQL : même un INSERT direct est refusé (23P01)', async () => {
    const prof = await idOf("SELECT id FROM users WHERE email = 'prof1@fsttanger.ma'");
    await expect(pool.query(
      'INSERT INTO reservations (salle_id, enseignant_id, debut, fin) VALUES ($1,$2,$3,$4)',
      [salle201, prof, at(10, 8.5), at(10, 9.5)])).rejects.toMatchObject({ code: '23P01' });
  });
});

describe('Libération dynamique des salles', () => {
  test('annuler une réservation libère la salle immédiatement', async () => {
    const r = await resa('prof1', salle202, 30, 8, 10);
    expect(r.status).toBe(201);
    expect((await resa('prof2', salle202, 30, 9, 10)).status).toBe(409);

    const del = await as('prof1').delete(`/api/reservations/${r.body.id}`);
    expect(del.status).toBe(200);
    expect(del.body.statut).toBe('annulee');
    expect((await resa('prof2', salle202, 30, 9, 10)).status).toBe(201);
  });

  test('un enseignant ne peut pas annuler la réservation d\'un autre (403)', async () => {
    const r = await resa('prof1', salle201, 31, 8, 10);
    expect((await as('prof2').delete(`/api/reservations/${r.body.id}`)).status).toBe(403);
    expect((await as('admin').delete(`/api/reservations/${r.body.id}`)).status).toBe(200); // l'admin peut
  });

  test('annuler une séance libère sa salle (réservable ensuite)', async () => {
    const { body } = await as('prof1').get('/api/seances/mes');
    const algo = body.find((s) => s.module === 'Algorithmique');
    const blocked = await as('prof2').post('/api/reservations').send({ salle_id: algo.salle_id, debut: algo.debut, fin: algo.fin });
    expect(blocked.status).toBe(409);

    const cancel = await as('prof1').post(`/api/seances/${algo.id}/annuler`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.statut).toBe('annulee');

    const ok = await as('prof2').post('/api/reservations').send({ salle_id: algo.salle_id, debut: algo.debut, fin: algo.fin });
    expect(ok.status).toBe(201);
  });

  test('un enseignant ne peut pas annuler la séance d\'un collègue (403)', async () => {
    const { body } = await as('prof2').get('/api/seances/mes');
    const bdd = body.find((s) => s.module === 'Bases de données');
    expect((await as('prof1').post(`/api/seances/${bdd.id}/annuler`)).status).toBe(403);
  });

  test('séance annulée deux fois => 409', async () => {
    const { body } = await as('prof1').get('/api/seances/mes');
    const reseaux = body.find((s) => s.module === 'Réseaux');
    expect((await as('prof1').post(`/api/seances/${reseaux.id}/annuler`)).status).toBe(200);
    expect((await as('prof1').post(`/api/seances/${reseaux.id}/annuler`)).status).toBe(409);
  });
});

describe('Agenda & disponibilité des salles', () => {
  test('salles libres / occupées sur un créneau', async () => {
    const r = await as('prof1').get('/api/salles/disponibilites').query({ debut: at(10, 8), fin: at(10, 10) });
    expect(r.status).toBe(200);
    const byName = Object.fromEntries(r.body.map((s) => [s.nom, s]));
    expect(byName['Salle 201'].libre).toBe(false);
    expect(byName['Amphi A'].libre).toBe(true);
  });

  test('l\'étudiant peut consulter l\'agenda d\'une salle', async () => {
    const r = await as('etu1').get(`/api/salles/${salle201}/agenda`);
    expect(r.status).toBe(200);
    expect(r.body.salle.nom).toBe('Salle 201');
  });
});

describe('Création de séances par l\'admin', () => {
  const body = (extra) => ({ module: 'Test', enseignant_id: null, groupe_id: null, salle_id: null, ...extra });
  let prof; let prof3; let g1; let g2;
  beforeAll(async () => {
    prof = await idOf("SELECT id FROM users WHERE email = 'prof1@fsttanger.ma'");
    prof3 = await idOf("SELECT id FROM users WHERE email = 'prof3@fsttanger.ma'");
    g1 = await idOf("SELECT g.id FROM groupes g JOIN filieres f ON f.id=g.filiere_id WHERE f.nom='LST Informatique' AND g.nom='G1'");
    g2 = await idOf("SELECT g.id FROM groupes g JOIN filieres f ON f.id=g.filiere_id WHERE f.nom='LST Informatique' AND g.nom='G2'");
  });

  test('séance valide créée, puis conflit de salle / enseignant / groupe => 409', async () => {
    const ok = await as('admin').post('/api/admin/seances')
      .send(body({ enseignant_id: prof, groupe_id: g1, salle_id: salle201, debut: at(40, 8), fin: at(40, 10) }));
    expect(ok.status).toBe(201);
    // même salle
    expect((await as('admin').post('/api/admin/seances')
      .send(body({ enseignant_id: prof3, groupe_id: g2, salle_id: salle201, debut: at(40, 9), fin: at(40, 11) }))).status).toBe(409);
    // même enseignant, autre salle
    expect((await as('admin').post('/api/admin/seances')
      .send(body({ enseignant_id: prof, groupe_id: g2, salle_id: salle202, debut: at(40, 9), fin: at(40, 11) }))).status).toBe(409);
    // même groupe, autre salle, autre enseignant
    expect((await as('admin').post('/api/admin/seances')
      .send(body({ enseignant_id: prof3, groupe_id: g1, salle_id: salle202, debut: at(40, 9), fin: at(40, 11) }))).status).toBe(409);
  });

  test('un non-enseignant ne peut pas être affecté à une séance', async () => {
    const etu = await idOf("SELECT id FROM users WHERE email = 'etudiant1@etu.fsttanger.ma'");
    const r = await as('admin').post('/api/admin/seances')
      .send(body({ enseignant_id: etu, groupe_id: g1, salle_id: salle202, debut: at(41, 8), fin: at(41, 10) }));
    expect(r.status).toBe(400);
  });
});

test('santé de l\'API', async () => {
  expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
});
