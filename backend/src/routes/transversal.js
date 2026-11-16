/**
 * Fonctions transversales de la conception (UC15, UC26, UC28, UC30) :
 * notifications, paramètres, signalement de pannes, statistiques d'absentéisme + export.
 * Monté après `authenticate` : chaque route déclare son contrôle de rôle.
 */
const express = require('express');
const v = require('../utils/validate');
const { query, tx } = require('../db');
const { h, bad, notFound, conflict } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { log } = require('../services/journal');
const { notify, notifyRole, safe } = require('../services/notifications');
const { DEFS, getAll } = require('../services/parametres');

const router = express.Router();

// ------------------------------------------------------------ Notifications
// Toujours filtrées sur l'utilisateur connecté : impossible de lire ou modifier celles d'un autre (IDOR).
router.get('/notifications', h(async (req, res) => {
  const limit = v.int(req.query.limit || 50, 'limit', { min: 1, max: 200 });
  const { rows } = await query(
    `SELECT id, message, lu, created_at FROM notifications WHERE user_id = $1
      ORDER BY created_at DESC, id DESC LIMIT $2`, [req.user.id, limit]);
  res.json(rows);
}));

router.get('/notifications/non-lues', h(async (req, res) => {
  const { rows } = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT lu', [req.user.id]);
  res.json({ non_lues: rows[0].n });
}));

router.post('/notifications/lues', h(async (req, res) => {
  const r = await query('UPDATE notifications SET lu = TRUE WHERE user_id = $1 AND NOT lu', [req.user.id]);
  res.json({ marquees: r.rowCount });
}));

router.post('/notifications/:id/lue', h(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const { rows } = await query(
    'UPDATE notifications SET lu = TRUE WHERE id = $1 AND user_id = $2 RETURNING id, message, lu, created_at', [id, req.user.id]);
  if (!rows[0]) throw notFound('Notification introuvable');
  res.json(rows[0]);
}));

// ---------------------------------------------------------------- Paramètres
// Lecture : tous (le pointage affiche la durée par défaut) ; écriture : chef de département uniquement.
router.get('/parametres', h(async (_req, res) => res.json(await getAll())));

router.put('/parametres', requireRole('admin'), h(async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length) throw bad('Aucun paramètre à modifier');
  const unknown = keys.filter((k) => !DEFS[k]);
  if (unknown.length) throw bad(`Paramètre inconnu : ${unknown.join(', ')}`);
  const values = {};
  for (const k of keys) values[k] = v.int(body[k], k, { min: DEFS[k].min, max: DEFS[k].max });
  await tx(async (c) => {
    for (const [k, val] of Object.entries(values)) {
      await c.query(
        `INSERT INTO parametres (cle, valeur) VALUES ($1, $2)
         ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur`, [k, String(val)]);
    }
  });
  await log(req, 'parametres.update', 'parametres', values);
  res.json(await getAll());
}));

// -------------------------------------------------------------------- Pannes
const PANNE_SELECT = `SELECT p.id, p.description, p.statut, p.created_at, p.resolue_le,
       e.nom AS equipement, s.nom AS salle, u.nom || ' ' || u.prenom AS signale_par
  FROM pannes p LEFT JOIN equipements e ON e.id = p.equipement_id LEFT JOIN salles s ON s.id = p.salle_id
  LEFT JOIN users u ON u.id = p.signale_par`;

/** Tous les rôles peuvent signaler ; seul le chef voit tout et clôture. */
router.get('/pannes', h(async (req, res) => {
  const statut = req.query.statut ? v.oneOf(req.query.statut, 'statut', ['ouverte', 'resolue']) : null;
  const own = req.user.role === 'admin' ? null : req.user.id;
  const { rows } = await query(
    `${PANNE_SELECT} WHERE ($1::int IS NULL OR p.signale_par = $1) AND ($2::text IS NULL OR p.statut = $2)
      ORDER BY (p.statut = 'ouverte') DESC, p.created_at DESC`, [own, statut]);
  res.json(rows);
}));

router.post('/pannes', h(async (req, res) => {
  const b = req.body || {};
  const equipementId = v.int(b.equipement_id, 'equipement_id', { min: 1, required: false });
  const salleId = v.int(b.salle_id, 'salle_id', { min: 1, required: false });
  if (!equipementId && !salleId) throw bad('Indiquez la salle ou l\'équipement en panne');
  const description = v.str(b.description, 'description', { max: 500 });
  const cible = await tx(async (c) => {
    let nom;
    if (equipementId) {
      const e = (await c.query('SELECT nom FROM equipements WHERE id = $1', [equipementId])).rows[0];
      if (!e) throw bad('Équipement introuvable');
      nom = e.nom;
    }
    if (salleId) {
      const s = (await c.query('SELECT nom FROM salles WHERE id = $1', [salleId])).rows[0];
      if (!s) throw bad('Salle introuvable');
      nom = nom ? `${nom} (${s.nom})` : s.nom;
    }
    const row = (await c.query(
      `INSERT INTO pannes (equipement_id, salle_id, signale_par, description) VALUES ($1,$2,$3,$4) RETURNING id`,
      [equipementId, salleId, req.user.id, description])).rows[0];
    return { id: row.id, nom };
  });
  await log(req, 'panne.signaler', 'pannes', { id: cible.id });
  await safe(notifyRole('admin', `Panne signalée : ${cible.nom} par ${req.user.nom} ${req.user.prenom}`));
  res.status(201).json((await query(`${PANNE_SELECT} WHERE p.id = $1`, [cible.id])).rows[0]);
}));

router.post('/pannes/:id/resoudre', requireRole('admin'), h(async (req, res) => {
  const id = v.int(req.params.id, 'id', { min: 1 });
  const out = await tx(async (c) => {
    const p = (await c.query('SELECT * FROM pannes WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!p) throw notFound('Panne introuvable');
    if (p.statut === 'resolue') throw conflict('Panne déjà résolue');
    await c.query("UPDATE pannes SET statut = 'resolue', resolue_par = $2, resolue_le = now() WHERE id = $1", [id, req.user.id]);
    const row = (await c.query(`${PANNE_SELECT} WHERE p.id = $1`, [id])).rows[0];
    if (p.signale_par) await notify([p.signale_par], `Votre signalement de panne (${row.equipement || row.salle}) a été résolu`, c);
    return row;
  });
  await log(req, 'panne.resoudre', 'pannes', { id });
  res.json(out);
}));

// ------------------------------------------------- Statistiques d'absentéisme
/** Admin : tout le département ; enseignant : uniquement ses propres séances ; étudiant : 403. */
const statsRoles = requireRole('admin', 'enseignant');

async function absenceStats(req) {
  const from = v.date(req.query.from, 'from', { required: false });
  const to = v.date(req.query.to, 'to', { required: false });
  const groupeId = v.int(req.query.groupe_id, 'groupe_id', { min: 1, required: false });
  const own = req.user.role === 'enseignant' ? req.user.id : null;
  const { rows } = await query(
    `SELECT u.id AS etudiant_id, u.nom, u.prenom, g.nom AS groupe, f.nom AS filiere,
            count(*)::int AS total,
            count(*) FILTER (WHERE p.statut = 'present')::int AS presents,
            count(*) FILTER (WHERE p.statut = 'retard')::int AS retards,
            count(*) FILTER (WHERE p.statut = 'absent')::int AS absents,
            count(*) FILTER (WHERE p.statut = 'absent_justifie')::int AS justifies
       FROM presences p
       JOIN seances s ON s.id = p.seance_id
       JOIN users u ON u.id = p.etudiant_id
       JOIN groupes g ON g.id = s.groupe_id
       JOIN filieres f ON f.id = g.filiere_id
      WHERE ($1::int IS NULL OR s.enseignant_id = $1)
        AND ($2::timestamptz IS NULL OR s.debut >= $2) AND ($3::timestamptz IS NULL OR s.debut <= $3)
        AND ($4::int IS NULL OR s.groupe_id = $4)
      GROUP BY u.id, g.id, f.id ORDER BY absents DESC, u.nom, u.prenom`, [own, from, to, groupeId]);
  return rows.map((r) => ({ ...r, taux_absence: r.total ? Math.round((r.absents / r.total) * 1000) / 10 : 0 }));
}

router.get('/stats/absences', statsRoles, h(async (req, res) => res.json(await absenceStats(req))));

const BOM = String.fromCharCode(0xfeff); // permet à Excel de détecter l'UTF-8

/** Une cellule CSV : guillemets échappés + neutralisation de l'injection de formule (=, +, -, @). */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export CSV (séparateur « ; » + BOM UTF-8 : s'ouvre directement dans Excel en français). */
router.get('/stats/absences/export', statsRoles, h(async (req, res) => {
  const rows = await absenceStats(req);
  const head = ['Nom', 'Prénom', 'Filière', 'Groupe', 'Séances', 'Présences', 'Retards', 'Absences', 'Absences justifiées', 'Taux d\'absence (%)'];
  const lines = [head, ...rows.map((r) => [
    r.nom, r.prenom, r.filiere, r.groupe, r.total, r.presents, r.retards, r.absents, r.justifies, r.taux_absence])];
  const csv = `${BOM}${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`;
  await log(req, 'stats.export', 'presences', { lignes: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="absences.csv"');
  res.send(csv);
}));

module.exports = router;
