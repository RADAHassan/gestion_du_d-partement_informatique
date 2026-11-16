/** Emplois du temps, annulation de séances et pointage (côté enseignant). */
const express = require('express');
const v = require('../utils/validate');
const config = require('../config');
const { query, tx } = require('../db');
const { h, bad, notFound, conflict, forbidden } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { log } = require('../services/journal');
const { closePointage, closeExpired } = require('../services/pointage');
const { generateCode } = require('../services/rules');

const router = express.Router();

/** Emploi du temps selon le rôle : admin = tout, enseignant = ses séances, étudiant = celles de son groupe. */
router.get('/seances/mes', h(async (req, res) => {
  const from = v.date(req.query.from, 'from', { required: false });
  const to = v.date(req.query.to, 'to', { required: false });
  const { id, role, groupe_id: groupeId } = req.user;
  const { rows } = await query(
    `SELECT s.id, s.module, s.debut, s.fin, s.statut, s.presence_validee, s.salle_id, s.groupe_id, s.enseignant_id,
            sa.nom AS salle, g.nom AS groupe, u.nom || ' ' || u.prenom AS enseignant,
            p.statut AS pointage_statut, p.expire_le AS pointage_expire_le,
            pr.statut AS ma_presence
       FROM seances s
       JOIN groupes g ON g.id = s.groupe_id
       JOIN users u ON u.id = s.enseignant_id
       LEFT JOIN salles sa ON sa.id = s.salle_id
       LEFT JOIN pointages p ON p.seance_id = s.id
       LEFT JOIN presences pr ON pr.seance_id = s.id AND pr.etudiant_id = $1
      WHERE ($2 = 'admin' OR ($2 = 'enseignant' AND s.enseignant_id = $1) OR ($2 = 'etudiant' AND s.groupe_id = $3))
        AND ($4::timestamptz IS NULL OR s.fin >= $4) AND ($5::timestamptz IS NULL OR s.debut <= $5)
      ORDER BY s.debut`, [id, role, groupeId, from, to]);
  res.json(rows);
}));

/** Charge une séance et vérifie qu'elle appartient à l'enseignant connecté (404 / 403). */
async function ownSeance(c, id, user, { forUpdate = false } = {}) {
  const { rows } = await c.query(`SELECT * FROM seances WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  const s = rows[0];
  if (!s) throw notFound('Séance introuvable');
  if (s.enseignant_id !== user.id) throw forbidden("Cette séance n'est pas la vôtre");
  return s;
}

/**
 * Annulation d'une séance (enseignant propriétaire ou admin) : le statut passe à "annulee",
 * ce qui libère immédiatement la salle (contraintes d'exclusion et vérifications ignorent les séances annulées).
 */
router.post('/seances/:id/annuler', requireRole('admin', 'enseignant'), h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const out = await tx(async (c) => {
    const s = (await c.query('SELECT * FROM seances WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!s) throw notFound('Séance introuvable');
    if (req.user.role !== 'admin' && s.enseignant_id !== req.user.id) throw forbidden("Cette séance n'est pas la vôtre");
    if (s.statut === 'annulee') throw conflict('Séance déjà annulée');
    if (s.presence_validee) throw conflict('Séance dont la présence est déjà validée');
    await c.query('DELETE FROM pointages WHERE seance_id = $1', [id]);
    await c.query('DELETE FROM presences WHERE seance_id = $1', [id]);
    return (await c.query("UPDATE seances SET statut = 'annulee' WHERE id = $1 RETURNING *", [id])).rows[0];
  });
  await log(req, 'seance.annuler', 'seances', { id, salle_id: out.salle_id });
  res.json(out);
}));

// ------------------------------------------------------- Pointage (enseignant)
const ens = requireRole('enseignant');

router.post('/seances/:id/pointage/ouvrir', ens, h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const minutes = v.int((req.body || {}).duree_minutes ?? config.pointageDefaultMinutes, 'duree_minutes', { min: 1, max: 60 });
  await closeExpired();
  const out = await tx(async (c) => {
    const s = await ownSeance(c, id, req.user, { forUpdate: true });
    if (s.statut !== 'planifiee') throw conflict(`Séance ${s.statut} : pointage impossible`);
    if (s.presence_validee) throw conflict('Feuille de présence déjà validée');
    const existing = (await c.query('SELECT * FROM pointages WHERE seance_id = $1', [id])).rows[0];
    if (existing && existing.statut === 'ouvert') throw conflict('Le pointage est déjà ouvert');

    let code;
    do { // code unique parmi les pointages ouverts
      code = generateCode(6);
    } while ((await c.query("SELECT 1 FROM pointages WHERE code = $1 AND statut = 'ouvert'", [code])).rowCount);

    return (await c.query(
      `INSERT INTO pointages (seance_id, code, ouvert_le, expire_le, statut)
       VALUES ($1, $2, now(), now() + make_interval(mins => $3), 'ouvert')
       ON CONFLICT (seance_id) DO UPDATE
         SET code = EXCLUDED.code, ouvert_le = now(), expire_le = EXCLUDED.expire_le, statut = 'ouvert', cloture_le = NULL
       RETURNING *`, [id, code, minutes])).rows[0];
  });
  await log(req, 'pointage.ouvrir', 'pointages', { seance_id: id, minutes });
  res.status(201).json(out);
}));

router.post('/seances/:id/pointage/fermer', ens, h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  await tx(async (c) => {
    await ownSeance(c, id, req.user, { forUpdate: true });
    const p = (await c.query('SELECT * FROM pointages WHERE seance_id = $1 FOR UPDATE', [id])).rows[0];
    if (!p) throw notFound('Aucun pointage pour cette séance');
    if (p.statut !== 'ouvert') throw conflict('Pointage déjà clôturé');
    await closePointage(c, p.id); // marque absents les non-pointés
  });
  await log(req, 'pointage.fermer', 'pointages', { seance_id: id });
  res.json(await feuille(id));
}));

async function feuille(seanceId) {
  const seance = (await query(
    `SELECT s.*, g.nom AS groupe FROM seances s JOIN groupes g ON g.id = s.groupe_id WHERE s.id = $1`, [seanceId])).rows[0];
  const pointage = (await query(
    `SELECT *, GREATEST(0, EXTRACT(EPOCH FROM (expire_le - now())))::int AS secondes_restantes
       FROM pointages WHERE seance_id = $1`, [seanceId])).rows[0] || null;
  const { rows: etudiants } = await query(
    `SELECT u.id AS etudiant_id, u.nom, u.prenom, p.statut, p.source, p.pointe_le
       FROM users u LEFT JOIN presences p ON p.etudiant_id = u.id AND p.seance_id = $1
      WHERE u.role = 'etudiant' AND u.groupe_id = $2 AND u.actif ORDER BY u.nom, u.prenom`, [seanceId, seance.groupe_id]);
  return { seance, pointage, etudiants };
}

router.get('/seances/:id/pointage', ens, h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  await ownSeance({ query }, id, req.user);
  await closeExpired(); // clôture automatique paresseuse
  res.json(await feuille(id));
}));

/** Correction manuelle de secours (avant validation de la feuille). */
router.put('/seances/:id/presences/:etudiantId', ens, h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const etudiantId = v.int(req.params.etudiantId, 'etudiantId');
  const statut = v.oneOf((req.body || {}).statut, 'statut', ['present', 'absent']);
  await tx(async (c) => {
    const s = await ownSeance(c, id, req.user, { forUpdate: true });
    if (s.presence_validee) throw conflict('Feuille déjà validée et transmise');
    const etu = await c.query(
      "SELECT 1 FROM users WHERE id = $1 AND role = 'etudiant' AND groupe_id = $2", [etudiantId, s.groupe_id]);
    if (!etu.rowCount) throw bad("Cet étudiant n'appartient pas au groupe de la séance");
    await c.query(
      `INSERT INTO presences (seance_id, etudiant_id, statut, source, pointe_le)
       VALUES ($1, $2, $3::text, 'manuel', CASE WHEN $3::text = 'present' THEN now() END)
       ON CONFLICT (seance_id, etudiant_id) DO UPDATE
         SET statut = EXCLUDED.statut, source = 'manuel', pointe_le = EXCLUDED.pointe_le`, [id, etudiantId, statut]);
  });
  await log(req, 'presence.correction', 'presences', { seance_id: id, etudiantId, statut });
  res.json(await feuille(id));
}));

/** Validation de la feuille par l'enseignant puis transmission au chef de département. */
router.post('/seances/:id/valider', ens, h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  await tx(async (c) => {
    const s = await ownSeance(c, id, req.user, { forUpdate: true });
    if (s.presence_validee) throw conflict('Feuille déjà validée');
    const p = (await c.query('SELECT * FROM pointages WHERE seance_id = $1 FOR UPDATE', [id])).rows[0];
    if (!p) throw conflict("Aucun pointage n'a été effectué pour cette séance");
    if (p.statut === 'ouvert') await closePointage(c, p.id); // clôture + absents automatiques
    await c.query(
      "UPDATE seances SET presence_validee = TRUE, transmise_le = now(), statut = 'terminee' WHERE id = $1", [id]);
  });
  await log(req, 'presence.valider', 'seances', { id });
  res.json(await feuille(id));
}));

module.exports = router;
