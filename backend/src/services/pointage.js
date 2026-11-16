const { tx, pool } = require('../db');
const { notify, notifyRole } = require('./notifications');
const { getInt } = require('./parametres');

const fmtDate = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Casablanca' });

/**
 * Clôture un pointage : tous les étudiants du groupe sans présence enregistrée
 * sont automatiquement marqués "absent". Les absents sont notifiés et le chef de département
 * est alerté quand un étudiant atteint le seuil d'absences non justifiées (paramètre `seuil_absences`).
 */
async function closePointage(client, pointageId) {
  const { rows } = await client.query(
    `UPDATE pointages SET statut = 'cloture', cloture_le = now()
      WHERE id = $1 AND statut = 'ouvert' RETURNING seance_id`, [pointageId]);
  if (!rows[0]) return false;
  const seanceId = rows[0].seance_id;

  const created = await client.query(
    `INSERT INTO presences (seance_id, etudiant_id, statut, source)
     SELECT s.id, u.id, 'absent', 'auto'
       FROM seances s
       JOIN users u ON u.groupe_id = s.groupe_id AND u.role = 'etudiant' AND u.actif
      WHERE s.id = $1
     ON CONFLICT (seance_id, etudiant_id) DO NOTHING
     RETURNING etudiant_id`, [seanceId]);

  if (created.rowCount) {
    const s = (await client.query('SELECT module, debut FROM seances WHERE id = $1', [seanceId])).rows[0];
    await notify(created.rows.map((r) => r.etudiant_id),
      `Absence enregistrée : ${s.module} du ${fmtDate(s.debut)}. Vous pouvez déposer un justificatif.`, client);

    const seuil = await getInt('seuil_absences', client);
    const { rows: atteints } = await client.query(
      `SELECT u.nom, u.prenom, count(*)::int AS n
         FROM presences p JOIN users u ON u.id = p.etudiant_id
        WHERE p.statut = 'absent' AND p.etudiant_id = ANY($1::int[])
        GROUP BY u.id HAVING count(*) = $2`,
      [created.rows.map((r) => r.etudiant_id), seuil]);
    for (const a of atteints) {
      await notifyRole('admin', `Seuil d'absences atteint : ${a.nom} ${a.prenom} (${a.n} absences non justifiées)`, client);
    }
  }
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

/**
 * Alerte de retard de retour : matériel durable validé dont la période est terminée et non rendu.
 * Une seule alerte par demande (colonne retard_notifie). Appelé par le planificateur.
 */
async function checkLateReturns() {
  return tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE demandes_materiel d SET retard_notifie = TRUE
         FROM equipements e, users u
        WHERE e.id = d.equipement_id AND u.id = d.enseignant_id
          AND d.statut = 'validee' AND e.type = 'durable' AND d.fin < now() AND NOT d.retard_notifie
        RETURNING d.id, d.enseignant_id, d.quantite, d.fin, e.nom AS equipement, u.nom, u.prenom`);
    for (const d of rows) {
      await notifyRole('admin',
        `Retard de retour : ${d.equipement} ×${d.quantite} (demande #${d.id}, ${d.nom} ${d.prenom}), à rendre le ${fmtDate(d.fin)}`, c);
      await notify([d.enseignant_id],
        `Merci de rendre ${d.equipement} ×${d.quantite} (demande #${d.id}) : la période est terminée.`, c);
    }
    return rows.length;
  });
}

module.exports = { closePointage, closeExpired, checkLateReturns };
