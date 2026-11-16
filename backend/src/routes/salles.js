/** Agenda des salles & réservations (lecture : tous les rôles ; réservation : enseignants). */
const express = require('express');
const v = require('../utils/validate');
const { query, tx } = require('../db');
const { h, bad, notFound, forbidden } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { log } = require('../services/journal');
const { lock, LOCK_SALLE, assertRoomFree, roomConflicts } = require('../services/conflicts');

const router = express.Router();

router.get('/salles', h(async (_req, res) => {
  const { rows } = await query('SELECT * FROM salles WHERE actif ORDER BY nom');
  res.json(rows);
}));

/** Salles libres / occupées sur un créneau donné. */
router.get('/salles/disponibilites', h(async (req, res) => {
  const { debut, fin } = v.period({ debut: req.query.debut, fin: req.query.fin });
  const { rows: salles } = await query('SELECT * FROM salles WHERE actif ORDER BY nom');
  const out = [];
  for (const s of salles) {
    const conflits = await roomConflicts({ query }, s.id, debut, fin);
    out.push({ ...s, libre: conflits.length === 0, occupations: conflits });
  }
  res.json(out);
}));

router.get('/salles/:id/agenda', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const from = v.date(req.query.from, 'from', { required: false }) || new Date(Date.now() - 86400000);
  const to = v.date(req.query.to, 'to', { required: false }) || new Date(Date.now() + 14 * 86400000);
  const salle = (await query('SELECT * FROM salles WHERE id = $1', [id])).rows[0];
  if (!salle) throw notFound('Salle introuvable');
  const occupations = await roomConflicts({ query }, id, from, to);
  res.json({ salle, occupations });
}));

router.get('/reservations', requireRole('admin', 'enseignant'), h(async (req, res) => {
  const own = req.user.role === 'enseignant' ? req.user.id : null;
  const { rows } = await query(
    `SELECT r.*, s.nom AS salle, u.nom || ' ' || u.prenom AS enseignant
       FROM reservations r JOIN salles s ON s.id = r.salle_id JOIN users u ON u.id = r.enseignant_id
      WHERE ($1::int IS NULL OR r.enseignant_id = $1) ORDER BY r.debut DESC`, [own]);
  res.json(rows);
}));

router.post('/reservations', requireRole('enseignant'), h(async (req, res) => {
  const b = req.body || {};
  const salleId = v.int(b.salle_id, 'salle_id', { min: 1 });
  const { debut, fin } = v.period(b);
  const motif = v.str(b.motif, 'motif', { required: false }) || '';
  if (fin <= new Date()) throw bad('Impossible de réserver dans le passé');

  const resa = await tx(async (c) => {
    const salle = (await c.query('SELECT actif FROM salles WHERE id = $1', [salleId])).rows[0];
    if (!salle || !salle.actif) throw bad('Salle invalide ou inactive');
    await lock(c, LOCK_SALLE, salleId); // sérialise les réservations concurrentes
    await assertRoomFree(c, salleId, debut, fin); // refus immédiat en cas de chevauchement (409)
    return (await c.query(
      'INSERT INTO reservations (salle_id, enseignant_id, debut, fin, motif) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [salleId, req.user.id, debut, fin, motif])).rows[0];
  });
  await log(req, 'reservation.create', 'reservations', { id: resa.id, salleId });
  res.status(201).json(resa);
}));

/** Annulation : la salle est immédiatement libérée (la contrainte ne vise que les réservations actives). */
router.delete('/reservations/:id', requireRole('admin', 'enseignant'), h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const r = (await query('SELECT * FROM reservations WHERE id = $1', [id])).rows[0];
  if (!r) throw notFound();
  if (req.user.role !== 'admin' && r.enseignant_id !== req.user.id) throw forbidden("Cette réservation ne vous appartient pas");
  const { rows } = await query("UPDATE reservations SET statut = 'annulee' WHERE id = $1 RETURNING *", [id]);
  await log(req, 'reservation.annuler', 'reservations', { id });
  res.json(rows[0]);
}));

module.exports = router;
