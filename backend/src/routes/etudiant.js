/** Espace étudiant : pointage par code, absences, justificatifs. + téléchargement sécurisé des justificatifs. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const v = require('../utils/validate');
const config = require('../config');
const { query, tx } = require('../db');
const { h, bad, notFound, conflict, forbidden, HttpError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { log } = require('../services/journal');
const { closeExpired } = require('../services/pointage');
const { getInt } = require('../services/parametres');
const { notifyRole, safe } = require('../services/notifications');

const student = express.Router();   // monté avec requireRole('etudiant')
const files = express.Router();     // téléchargement : étudiant propriétaire ou admin

// ---------------------------------------------------------------- Pointage
const pointageLimiter = rateLimit({
  windowMs: 60 * 1000, limit: config.isTest ? 10000 : 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de tentatives de pointage' },
});

student.post('/pointage', pointageLimiter, h(async (req, res) => {
  const code = v.str((req.body || {}).code, 'code', { max: 10 }).toUpperCase();
  await closeExpired(); // un code expiré ne doit jamais être accepté
  const retardMinutes = await getInt('retard_minutes');
  const out = await tx(async (c) => {
    // « en retard » = pointage plus de `retard_minutes` après l'ouverture du pointage (paramètre du chef)
    const { rows } = await c.query(
      `SELECT p.seance_id, s.module, s.debut,
              (now() > p.ouvert_le + make_interval(mins => $3)) AS en_retard
         FROM pointages p JOIN seances s ON s.id = p.seance_id
        WHERE p.code = $1 AND p.statut = 'ouvert' AND p.expire_le > now()
          AND s.groupe_id = $2 AND s.statut = 'planifiee' FOR UPDATE OF p`, [code, req.user.groupe_id, retardMinutes]);
    if (!rows[0]) throw notFound('Code invalide, expiré ou non destiné à votre groupe');
    const statut = rows[0].en_retard ? 'retard' : 'present';
    const r = await c.query(
      `INSERT INTO presences (seance_id, etudiant_id, statut, source, pointe_le)
       VALUES ($1, $2, $3, 'etudiant', now())
       ON CONFLICT (seance_id, etudiant_id) DO UPDATE
         SET statut = EXCLUDED.statut, source = 'etudiant', pointe_le = now() WHERE presences.statut = 'absent'
       RETURNING id`, [rows[0].seance_id, req.user.id, statut]);
    const deja = r.rowCount === 0;
    const final = deja
      ? (await c.query('SELECT statut FROM presences WHERE seance_id = $1 AND etudiant_id = $2', [rows[0].seance_id, req.user.id])).rows[0].statut
      : statut;
    return { statut: final, module: rows[0].module, debut: rows[0].debut, deja_pointe: deja };
  });
  await log(req, 'pointage.etudiant', 'presences', { module: out.module, statut: out.statut });
  res.status(out.deja_pointe ? 200 : 201).json(out);
}));

// ----------------------------------------------------------------- Absences
student.get('/absences/mes', h(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.statut, p.source, p.pointe_le, s.module, s.debut, s.fin,
            j.id AS justificatif_id, j.statut AS justificatif_statut, j.commentaire AS justificatif_commentaire
       FROM presences p JOIN seances s ON s.id = p.seance_id
       LEFT JOIN LATERAL (SELECT * FROM justificatifs WHERE presence_id = p.id ORDER BY created_at DESC LIMIT 1) j ON TRUE
      WHERE p.etudiant_id = $1 ORDER BY s.debut DESC`, [req.user.id]);
  res.json(rows);
}));

// ------------------------------------------------------------ Justificatifs
fs.mkdirSync(config.uploadDir, { recursive: true });
const ALLOWED = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const MAGIC = {
  'application/pdf': (b) => b.subarray(0, 4).toString() === '%PDF',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    // nom aléatoire : jamais celui fourni par le client (pas de path traversal)
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (ALLOWED[file.mimetype] || '.bin')),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype]
    ? cb(null, true)
    : cb(new HttpError(415, 'Format non accepté (PDF, JPEG ou PNG uniquement)'))),
});

student.post('/absences/:presenceId/justificatif', upload.single('fichier'), h(async (req, res) => {
  const file = req.file;
  const discard = () => file && fs.promises.unlink(file.path).catch(() => {});
  try {
    if (!file) throw bad('Fichier manquant (champ "fichier")');
    const presenceId = v.int(req.params.presenceId, 'presenceId', { min: 1 });
    const motif = v.str((req.body || {}).motif, 'motif', { max: 500, required: false }) || '';

    // vérifie la signature réelle du fichier (et pas seulement le Content-Type déclaré)
    const head = Buffer.alloc(8);
    const fd = await fs.promises.open(file.path, 'r');
    await fd.read(head, 0, 8, 0); await fd.close();
    if (!MAGIC[file.mimetype](head)) throw new HttpError(415, 'Contenu du fichier incohérent avec son type');

    const row = await tx(async (c) => {
      const p = (await c.query('SELECT * FROM presences WHERE id = $1 FOR UPDATE', [presenceId])).rows[0];
      if (!p || p.etudiant_id !== req.user.id) throw notFound('Absence introuvable');
      if (p.statut !== 'absent') throw conflict("Cette absence n'est pas à justifier");
      const open = await c.query(
        "SELECT 1 FROM justificatifs WHERE presence_id = $1 AND statut IN ('en_attente','valide')", [presenceId]);
      if (open.rowCount) throw conflict('Un justificatif est déjà en cours de traitement');
      return (await c.query(
        `INSERT INTO justificatifs (presence_id, etudiant_id, fichier, nom_original, mime, motif)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, presence_id, statut, created_at`,
        [presenceId, req.user.id, file.filename, v.stripHtml(file.originalname).slice(0, 200) || 'fichier',
          file.mimetype, motif])).rows[0];
    });
    await log(req, 'justificatif.depot', 'justificatifs', { id: row.id });
    await safe(notifyRole('admin', `Nouveau justificatif d'absence déposé par ${req.user.nom} ${req.user.prenom}`));
    res.status(201).json(row);
  } catch (e) {
    await discard();
    throw e;
  }
}));

files.get('/justificatifs/:id/fichier', h(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const j = (await query('SELECT * FROM justificatifs WHERE id = $1', [id])).rows[0];
  if (!j) throw notFound();
  if (req.user.role !== 'admin' && !(req.user.role === 'etudiant' && j.etudiant_id === req.user.id)) {
    throw forbidden('Accès au justificatif interdit');
  }
  const full = path.join(config.uploadDir, path.basename(j.fichier));
  res.setHeader('Content-Type', j.mime);
  res.setHeader('Content-Disposition', `attachment; filename="justificatif-${id}${path.extname(full)}"`);
  res.sendFile(full);
}));

module.exports = { student, files, requireStudent: requireRole('etudiant') };
