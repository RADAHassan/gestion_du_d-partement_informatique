/** Inventaire & demandes d'emprunt (enseignants). Admin : lecture de l'inventaire. */
const express = require('express');
const v = require('../utils/validate');
const { query, tx } = require('../db');
const { h, bad, notFound, conflict, forbidden } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { log } = require('../services/journal');
const { notifyRole, safe } = require('../services/notifications');
const { lock, LOCK_EQUIP, availableQty } = require('../services/conflicts');

const router = express.Router();

router.get('/materiel', requireRole('admin', 'enseignant'), h(async (req, res) => {
  const debut = v.date(req.query.debut, 'debut', { required: false });
  const fin = v.date(req.query.fin, 'fin', { required: false });
  const { rows } = await query('SELECT * FROM equipements WHERE actif ORDER BY nom');
  const out = [];
  for (const e of rows) {
    const disponible = e.type === 'durable' && debut && fin
      ? Math.max(await availableQty({ query }, e, debut, fin), 0) : e.quantite;
    out.push({ ...e, disponible });
  }
  res.json(out);
}));

router.get('/materiel/demandes/mes', requireRole('enseignant'), h(async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, e.nom AS equipement, e.type AS equipement_type FROM demandes_materiel d
       JOIN equipements e ON e.id = d.equipement_id WHERE d.enseignant_id = $1 ORDER BY d.created_at DESC`, [req.user.id]);
  res.json(rows);
}));

router.post('/materiel/demandes', requireRole('enseignant'), h(async (req, res) => {
  const b = req.body || {};
  const equipementId = v.int(b.equipement_id, 'equipement_id', { min: 1 });
  const quantite = v.int(b.quantite, 'quantite', { min: 1, max: 100000 });
  const motif = v.str(b.motif, 'motif', { required: false }) || '';

  const demande = await tx(async (c) => {
    await lock(c, LOCK_EQUIP, equipementId);
    const eq = (await c.query('SELECT * FROM equipements WHERE id = $1 AND actif FOR UPDATE', [equipementId])).rows[0];
    if (!eq) throw notFound('Équipement introuvable');
    let debut; let fin;
    if (eq.type === 'durable') {
      ({ debut, fin } = v.period(b));
      if (fin <= new Date()) throw bad('Période dans le passé');
      const dispo = await availableQty(c, eq, debut, fin);
      if (quantite > dispo) throw conflict(`Matériel indisponible sur ce créneau (${Math.max(dispo, 0)} disponible)`);
    } else {
      if (quantite > eq.quantite) throw conflict(`Stock insuffisant (${eq.quantite} disponible)`);
      debut = v.date(b.debut, 'debut', { required: false }) || new Date();
      fin = debut;
    }
    return (await c.query(
      `INSERT INTO demandes_materiel (equipement_id, enseignant_id, quantite, debut, fin, motif)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [equipementId, req.user.id, quantite, debut, fin, motif])).rows[0];
  });
  await log(req, 'demande.create', 'demandes_materiel', { id: demande.id });
  const eq = (await query('SELECT nom FROM equipements WHERE id = $1', [equipementId])).rows[0];
  await safe(notifyRole('admin',
    `Nouvelle demande de matériel : ${eq.nom} ×${quantite} par ${req.user.nom} ${req.user.prenom}`));
  res.status(201).json(demande);
}));

router.delete('/materiel/demandes/:id', requireRole('enseignant'), h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const out = await tx(async (c) => {
    const d = (await c.query(
      'SELECT d.*, e.type FROM demandes_materiel d JOIN equipements e ON e.id = d.equipement_id WHERE d.id = $1 FOR UPDATE OF d',
      [id])).rows[0];
    if (!d) throw notFound();
    if (d.enseignant_id !== req.user.id) throw forbidden('Cette demande ne vous appartient pas');
    if (!['en_attente', 'validee'].includes(d.statut)) throw conflict(`Demande ${d.statut} : annulation impossible`);
    if (d.statut === 'validee' && d.type === 'consommable') throw conflict('Consommable déjà prélevé : contactez le chef de département');
    return (await c.query("UPDATE demandes_materiel SET statut = 'annulee' WHERE id = $1 RETURNING *", [id])).rows[0];
  });
  await log(req, 'demande.annuler', 'demandes_materiel', { id });
  res.json(out);
}));

module.exports = router;
