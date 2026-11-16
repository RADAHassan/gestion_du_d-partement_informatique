/**
 * Routes réservées au Chef de département (rôle "admin").
 * Le contrôle d'accès est appliqué au montage : authenticate + requireRole('admin').
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const v = require('../utils/validate');
const config = require('../config');
const { query, tx } = require('../db');
const { h, bad, notFound, conflict } = require('../utils/errors');
const { crud } = require('./crud');
const { log } = require('../services/journal');
const { lock, LOCK_SALLE, LOCK_EQUIP, assertRoomFree, availableQty } = require('../services/conflicts');
const { applyMovement, syncAlert } = require('../services/stock');
const { notify } = require('../services/notifications');

const router = express.Router();

// ---------------------------------------------------------------- Comptes
const USER_COLS = `u.id, u.email, u.nom, u.prenom, u.role, u.actif, u.groupe_id, u.created_at,
                   g.nom AS groupe, f.nom AS filiere`;
const USER_FROM = `users u LEFT JOIN groupes g ON g.id = u.groupe_id LEFT JOIN filieres f ON f.id = g.filiere_id`;
const ROLES = ['admin', 'enseignant', 'etudiant'];

router.get('/users', h(async (req, res) => {
  const role = req.query.role ? v.oneOf(req.query.role, 'role', ROLES) : null;
  const { rows } = await query(
    `SELECT ${USER_COLS} FROM ${USER_FROM} WHERE ($1::role_t IS NULL OR u.role = $1) ORDER BY u.role, u.nom, u.prenom`,
    [role]);
  res.json(rows);
}));

router.post('/users', h(async (req, res) => {
  const b = req.body || {};
  const role = v.oneOf(b.role, 'role', ROLES);
  const groupeId = v.int(b.groupe_id, 'groupe_id', { required: role === 'etudiant' });
  const hash = await bcrypt.hash(v.password(b.password), config.bcryptRounds);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, nom, prenom, role, groupe_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, nom, prenom, role, groupe_id, actif`,
    [v.email(b.email), hash, v.str(b.nom, 'nom', { max: 100 }), v.str(b.prenom, 'prenom', { max: 100 }),
      role, role === 'etudiant' ? groupeId : null]);
  await log(req, 'user.create', 'users', { id: rows[0].id, role });
  res.status(201).json(rows[0]);
}));

router.put('/users/:id', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const b = req.body || {};
  const sets = []; const vals = [];
  const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
  if (b.email !== undefined) add('email', v.email(b.email));
  if (b.nom !== undefined) add('nom', v.str(b.nom, 'nom', { max: 100 }));
  if (b.prenom !== undefined) add('prenom', v.str(b.prenom, 'prenom', { max: 100 }));
  if (b.role !== undefined) add('role', v.oneOf(b.role, 'role', ROLES));
  if (b.groupe_id !== undefined) add('groupe_id', v.int(b.groupe_id, 'groupe_id', { required: false }));
  if (b.actif !== undefined) add('actif', v.bool(b.actif, 'actif'));
  if (b.password) add('password_hash', await bcrypt.hash(v.password(b.password), config.bcryptRounds));
  if (!sets.length) throw bad('Aucun champ à modifier');
  vals.push(id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING id, email, nom, prenom, role, groupe_id, actif`, vals);
  if (!rows[0]) throw notFound();
  await log(req, 'user.update', 'users', { id, champs: Object.keys(b).filter((k) => k !== 'password') });
  res.json(rows[0]);
}));

router.delete('/users/:id', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  if (id === req.user.id) throw conflict('Vous ne pouvez pas supprimer votre propre compte');
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
  if (!rowCount) throw notFound();
  await log(req, 'user.delete', 'users', { id });
  res.status(204).end();
}));

// ---------------------------------------------- Cycles / filières / groupes
crud(router, '/cycles', 'cycles', [{ name: 'nom', type: 'str', max: 100 }], { entity: 'cycle' });
crud(router, '/filieres', 'filieres', [
  { name: 'nom', type: 'str', max: 100 }, { name: 'cycle_id', type: 'int', min: 1 }],
{ entity: 'filiere', listSql: 'SELECT f.*, c.nom AS cycle FROM filieres f JOIN cycles c ON c.id = f.cycle_id ORDER BY c.nom, f.nom' });
crud(router, '/groupes', 'groupes', [
  { name: 'nom', type: 'str', max: 100 }, { name: 'filiere_id', type: 'int', min: 1 }],
{ entity: 'groupe', listSql: `SELECT g.*, f.nom AS filiere FROM groupes g JOIN filieres f ON f.id = g.filiere_id ORDER BY f.nom, g.nom` });

// ------------------------------------------------------- Salles & équipements
crud(router, '/salles', 'salles', [
  { name: 'nom', type: 'str', max: 100 },
  { name: 'type', type: 'enum', values: ['cours', 'tp', 'amphi'], required: false, def: 'cours' },
  { name: 'capacite', type: 'int', min: 1, max: 2000 },
  { name: 'actif', type: 'bool' }], { entity: 'salle', listSql: 'SELECT * FROM salles ORDER BY nom' });

crud(router, '/equipements', 'equipements', [
  { name: 'nom', type: 'str', max: 150 },
  { name: 'categorie', type: 'str', max: 100, required: false },
  { name: 'type', type: 'enum', values: ['durable', 'consommable'] },
  { name: 'quantite', type: 'int', min: 0, max: 1000000, required: false },
  { name: 'seuil_min', type: 'int', min: 0, max: 1000000, required: false },
  { name: 'actif', type: 'bool' }], {
  entity: 'equipement',
  listSql: 'SELECT * FROM equipements ORDER BY nom',
  // une modification manuelle du stock / du seuil doit aussi (dés)activer l'alerte
  afterWrite: (row) => tx((c) => syncAlert(c, row)),
});

// --------------------------------------------------------------------- Stock
router.post('/equipements/:id/mouvements', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const b = req.body || {};
  const type = v.oneOf(b.type, 'type', ['entree', 'sortie']);
  const quantite = v.int(b.quantite, 'quantite', { min: 1, max: 1000000 });
  const motif = v.str(b.motif, 'motif', { required: false }) || '';
  const result = await tx((c) => applyMovement(c, { equipementId: id, type, quantite, motif, userId: req.user.id }));
  await log(req, `stock.${type}`, 'equipements', { id, quantite, alerte: !!result.alerte });
  res.status(201).json(result);
}));

router.get('/mouvements', h(async (req, res) => {
  const limit = v.int(req.query.limit || 100, 'limit', { min: 1, max: 500 });
  const { rows } = await query(
    `SELECT m.*, e.nom AS equipement, u.nom || ' ' || u.prenom AS utilisateur
       FROM mouvements_stock m JOIN equipements e ON e.id = m.equipement_id LEFT JOIN users u ON u.id = m.user_id
      ORDER BY m.created_at DESC, m.id DESC LIMIT $1`, [limit]);
  res.json(rows);
}));

router.get('/alertes', h(async (_req, res) => {
  const { rows } = await query(
    `SELECT a.*, e.nom AS equipement FROM alertes_stock a JOIN equipements e ON e.id = a.equipement_id
      ORDER BY a.resolue, a.created_at DESC`);
  res.json(rows);
}));

// -------------------------------------------------------------------- Séances
router.get('/seances', h(async (req, res) => {
  const from = v.date(req.query.from, 'from', { required: false });
  const to = v.date(req.query.to, 'to', { required: false });
  const { rows } = await query(
    `SELECT s.*, u.nom || ' ' || u.prenom AS enseignant, g.nom AS groupe, f.nom AS filiere, sa.nom AS salle
       FROM seances s JOIN users u ON u.id = s.enseignant_id JOIN groupes g ON g.id = s.groupe_id
       JOIN filieres f ON f.id = g.filiere_id LEFT JOIN salles sa ON sa.id = s.salle_id
      WHERE ($1::timestamptz IS NULL OR s.fin >= $1) AND ($2::timestamptz IS NULL OR s.debut <= $2)
      ORDER BY s.debut`, [from, to]);
  res.json(rows);
}));

router.post('/seances', h(async (req, res) => {
  const b = req.body || {};
  const module_ = v.str(b.module, 'module', { max: 150 });
  const enseignantId = v.int(b.enseignant_id, 'enseignant_id', { min: 1 });
  const groupeId = v.int(b.groupe_id, 'groupe_id', { min: 1 });
  const salleId = v.int(b.salle_id, 'salle_id', { min: 1 });
  const { debut, fin } = v.period(b);

  const seance = await tx(async (c) => {
    const ens = await c.query("SELECT 1 FROM users WHERE id = $1 AND role = 'enseignant' AND actif", [enseignantId]);
    if (!ens.rowCount) throw bad('Enseignant invalide');
    const salle = await c.query('SELECT 1 FROM salles WHERE id = $1 AND actif', [salleId]);
    if (!salle.rowCount) throw bad('Salle invalide ou inactive');
    const grp = await c.query('SELECT 1 FROM groupes WHERE id = $1', [groupeId]);
    if (!grp.rowCount) throw bad('Groupe invalide');

    await lock(c, LOCK_SALLE, salleId);
    await assertRoomFree(c, salleId, debut, fin);
    const clash = await c.query(
      `SELECT id, module FROM seances WHERE statut <> 'annulee'
         AND (enseignant_id = $1 OR groupe_id = $2)
         AND tstzrange(debut, fin) && tstzrange($3::timestamptz, $4::timestamptz)`,
      [enseignantId, groupeId, debut, fin]);
    if (clash.rowCount) throw conflict("L'enseignant ou le groupe a déjà une séance sur ce créneau", { conflits: clash.rows });

    const { rows } = await c.query(
      `INSERT INTO seances (module, enseignant_id, groupe_id, salle_id, debut, fin)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [module_, enseignantId, groupeId, salleId, debut, fin]);
    return rows[0];
  });
  await log(req, 'seance.create', 'seances', { id: seance.id });
  res.status(201).json(seance);
}));

// --------------------------------------------------- Demandes de matériel
router.get('/demandes', h(async (req, res) => {
  const statut = req.query.statut
    ? v.oneOf(req.query.statut, 'statut', ['en_attente', 'validee', 'refusee', 'annulee', 'retournee']) : null;
  const { rows } = await query(
    `SELECT d.*, e.nom AS equipement, e.type AS equipement_type, u.nom || ' ' || u.prenom AS enseignant
       FROM demandes_materiel d JOIN equipements e ON e.id = d.equipement_id JOIN users u ON u.id = d.enseignant_id
      WHERE ($1::text IS NULL OR d.statut = $1) ORDER BY d.created_at DESC`, [statut]);
  res.json(rows);
}));

async function loadDemande(c, id, expected) {
  const { rows } = await c.query('SELECT * FROM demandes_materiel WHERE id = $1 FOR UPDATE', [id]);
  const d = rows[0];
  if (!d) throw notFound('Demande introuvable');
  if (!expected.includes(d.statut)) throw conflict(`Demande déjà traitée (statut : ${d.statut})`);
  return d;
}

router.post('/demandes/:id/valider', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const out = await tx(async (c) => {
    const d = await loadDemande(c, id, ['en_attente']);
    await lock(c, LOCK_EQUIP, d.equipement_id);
    const eq = (await c.query('SELECT * FROM equipements WHERE id = $1 FOR UPDATE', [d.equipement_id])).rows[0];
    if (eq.type === 'durable') {
      const dispo = await availableQty(c, eq, d.debut, d.fin, d.id);
      if (d.quantite > dispo) throw conflict(`Matériel indisponible sur ce créneau (${Math.max(dispo, 0)} disponible)`);
    } else {
      await applyMovement(c, { equipementId: eq.id, type: 'sortie', quantite: d.quantite, motif: `Demande #${d.id}`, userId: req.user.id });
    }
    const row = (await c.query(
      "UPDATE demandes_materiel SET statut = 'validee', traite_par = $2, traite_le = now() WHERE id = $1 RETURNING *",
      [id, req.user.id])).rows[0];
    await notify([d.enseignant_id], `Votre demande de matériel #${id} (${eq.nom} ×${d.quantite}) a été validée`, c);
    return row;
  });
  await log(req, 'demande.valider', 'demandes_materiel', { id });
  res.json(out);
}));

router.post('/demandes/:id/refuser', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const out = await tx(async (c) => {
    const d = await loadDemande(c, id, ['en_attente']);
    const row = (await c.query(
      "UPDATE demandes_materiel SET statut = 'refusee', traite_par = $2, traite_le = now() WHERE id = $1 RETURNING *",
      [id, req.user.id])).rows[0];
    const eq = (await c.query('SELECT nom FROM equipements WHERE id = $1', [d.equipement_id])).rows[0];
    await notify([d.enseignant_id], `Votre demande de matériel #${id} (${eq.nom} ×${d.quantite}) a été refusée`, c);
    return row;
  });
  await log(req, 'demande.refuser', 'demandes_materiel', { id });
  res.json(out);
}));

router.post('/demandes/:id/retour', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const out = await tx(async (c) => {
    await loadDemande(c, id, ['validee']);
    return (await c.query(
      "UPDATE demandes_materiel SET statut = 'retournee', traite_le = now() WHERE id = $1 RETURNING *", [id])).rows[0];
  });
  await log(req, 'demande.retour', 'demandes_materiel', { id });
  res.json(out);
}));

// ------------------------------------------------- Justificatifs & feuilles
router.get('/justificatifs', h(async (req, res) => {
  const statut = req.query.statut ? v.oneOf(req.query.statut, 'statut', ['en_attente', 'valide', 'refuse']) : null;
  const { rows } = await query(
    `SELECT j.id, j.presence_id, j.motif, j.statut, j.commentaire, j.nom_original, j.mime, j.created_at,
            u.nom || ' ' || u.prenom AS etudiant, s.module, s.debut
       FROM justificatifs j JOIN users u ON u.id = j.etudiant_id
       JOIN presences p ON p.id = j.presence_id JOIN seances s ON s.id = p.seance_id
      WHERE ($1::text IS NULL OR j.statut = $1) ORDER BY j.created_at DESC`, [statut]);
  res.json(rows);
}));

async function traiterJustificatif(req, res, valide) {
  const id = v.int(req.params.id, 'id');
  const commentaire = v.str((req.body || {}).commentaire, 'commentaire', { max: 500, required: false });
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM justificatifs WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound();
    if (rows[0].statut !== 'en_attente') throw conflict('Justificatif déjà traité');
    const j = (await c.query(
      `UPDATE justificatifs SET statut = $2, commentaire = $3, traite_par = $4, traite_le = now()
        WHERE id = $1 RETURNING *`, [id, valide ? 'valide' : 'refuse', commentaire, req.user.id])).rows[0];
    if (valide) await c.query("UPDATE presences SET statut = 'absent_justifie' WHERE id = $1 AND statut = 'absent'", [j.presence_id]);
    await notify([j.etudiant_id], valide
      ? 'Votre justificatif d\'absence a été accepté'
      : `Votre justificatif d'absence a été refusé${commentaire ? ` : ${commentaire}` : ''}`, c);
    return j;
  });
  await log(req, valide ? 'justificatif.valider' : 'justificatif.refuser', 'justificatifs', { id });
  res.json(out);
}
router.post('/justificatifs/:id/valider', h((req, res) => traiterJustificatif(req, res, true)));
router.post('/justificatifs/:id/refuser', h((req, res) => traiterJustificatif(req, res, false)));

router.get('/feuilles', h(async (_req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.module, s.debut, s.transmise_le, u.nom || ' ' || u.prenom AS enseignant, g.nom AS groupe,
            count(*) FILTER (WHERE p.statut = 'present')::int AS presents,
            count(*) FILTER (WHERE p.statut = 'retard')::int AS retards,
            count(*) FILTER (WHERE p.statut = 'absent')::int AS absents,
            count(*) FILTER (WHERE p.statut = 'absent_justifie')::int AS justifies
       FROM seances s JOIN users u ON u.id = s.enseignant_id JOIN groupes g ON g.id = s.groupe_id
       LEFT JOIN presences p ON p.seance_id = s.id
      WHERE s.transmise_le IS NOT NULL GROUP BY s.id, u.id, g.id ORDER BY s.transmise_le DESC`);
  res.json(rows);
}));

// ---------------------------------------------------- Statistiques & journal
router.get('/stats', h(async (_req, res) => {
  const one = async (sql) => (await query(sql)).rows;
  const [roles, seancesJour, sallesOcc, demandes, justifs, alertes, abs, topAbs, resa] = await Promise.all([
    one('SELECT role, count(*)::int AS n FROM users WHERE actif GROUP BY role'),
    one(`SELECT count(*)::int AS n FROM seances WHERE statut <> 'annulee' AND debut::date = CURRENT_DATE`),
    one(`SELECT count(DISTINCT salle_id)::int AS n FROM (
           SELECT salle_id FROM seances WHERE statut <> 'annulee' AND now() >= debut AND now() < fin
           UNION ALL SELECT salle_id FROM reservations WHERE statut = 'active' AND now() >= debut AND now() < fin) x`),
    one("SELECT count(*)::int AS n FROM demandes_materiel WHERE statut = 'en_attente'"),
    one("SELECT count(*)::int AS n FROM justificatifs WHERE statut = 'en_attente'"),
    one('SELECT count(*)::int AS n FROM alertes_stock WHERE NOT resolue'),
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE statut = 'present')::int AS presents,
                count(*) FILTER (WHERE statut = 'retard')::int AS retards,
                count(*) FILTER (WHERE statut = 'absent')::int AS absents,
                count(*) FILTER (WHERE statut = 'absent_justifie')::int AS justifies FROM presences`),
    one(`SELECT u.nom || ' ' || u.prenom AS etudiant, count(*)::int AS absences
           FROM presences p JOIN users u ON u.id = p.etudiant_id WHERE p.statut = 'absent'
          GROUP BY u.id ORDER BY absences DESC LIMIT 5`),
    one("SELECT count(*)::int AS n FROM reservations WHERE statut = 'active' AND fin > now()"),
  ]);
  const total = await one('SELECT count(*)::int AS n FROM salles WHERE actif');
  res.json({
    utilisateurs: Object.fromEntries(roles.map((r) => [r.role, r.n])),
    seances_aujourdhui: seancesJour[0].n,
    salles_occupees: sallesOcc[0].n,
    salles_total: total[0].n,
    reservations_a_venir: resa[0].n,
    demandes_en_attente: demandes[0].n,
    justificatifs_en_attente: justifs[0].n,
    alertes_stock: alertes[0].n,
    presences: abs[0],
    taux_absence: abs[0].total ? Math.round(((abs[0].absents) / abs[0].total) * 1000) / 10 : 0,
    top_absents: topAbs,
  });
}));

router.get('/journal', h(async (req, res) => {
  const limit = v.int(req.query.limit || 100, 'limit', { min: 1, max: 500 });
  const { rows } = await query(
    `SELECT j.id, j.action, j.entite, j.details, j.ip, j.created_at, u.nom || ' ' || u.prenom AS utilisateur
       FROM journal j LEFT JOIN users u ON u.id = j.user_id ORDER BY j.created_at DESC, j.id DESC LIMIT $1`, [limit]);
  res.json(rows);
}));

module.exports = router;
