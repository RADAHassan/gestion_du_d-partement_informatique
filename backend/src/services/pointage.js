const { tx, pool } = require('../db');

/**
 * Clôture un pointage : tous les étudiants du groupe sans présence enregistrée
 * sont automatiquement marqués "absent".
 */
async function closePointage(client, pointageId) {
  const { rows } = await client.query(
    `UPDATE pointages SET statut = 'cloture', cloture_le = now()
      WHERE id = $1 AND statut = 'ouvert' RETURNING seance_id`, [pointageId]);
  if (!rows[0]) return false;
  await client.query(
    `INSERT INTO presences (seance_id, etudiant_id, statut, source)
     SELECT s.id, u.id, 'absent', 'auto'
       FROM seances s
       JOIN users u ON u.groupe_id = s.groupe_id AND u.role = 'etudiant' AND u.actif
      WHERE s.id = $1
     ON CONFLICT (seance_id, etudiant_id) DO NOTHING`, [rows[0].seance_id]);
  return true;
}

/** Clôture tous les pointages dont le délai est dépassé (appelé par un timer et "paresseusement"). */
async function closeExpired() {
  const { rows } = await pool.query(
    "SELECT id FROM pointages WHERE statut = 'ouvert' AND expire_le <= now()");
  for (const { id } of rows) {
    await tx((c) => closePointage(c, id));
  }
  return rows.length;
}

module.exports = { closePointage, closeExpired };
