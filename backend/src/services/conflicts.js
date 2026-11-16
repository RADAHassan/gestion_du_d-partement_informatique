const { conflict } = require('../utils/errors');

const LOCK_SALLE = 1;
const LOCK_EQUIP = 2;

/** Verrou applicatif (transaction) pour sérialiser les réservations concurrentes d'une même ressource. */
const lock = (client, ns, id) => client.query('SELECT pg_advisory_xact_lock($1, $2)', [ns, id]);

/** Occupations d'une salle (séances + réservations actives) chevauchant la période. */
async function roomConflicts(client, salleId, debut, fin, { excludeSeanceId = null, excludeReservationId = null } = {}) {
  const { rows } = await client.query(
    `SELECT 'seance' AS type, id, module AS libelle, debut, fin FROM seances
       WHERE salle_id = $1 AND statut <> 'annulee'
         AND tstzrange(debut, fin) && tstzrange($2::timestamptz, $3::timestamptz)
         AND ($4::int IS NULL OR id <> $4)
     UNION ALL
     SELECT 'reservation', id, motif, debut, fin FROM reservations
       WHERE salle_id = $1 AND statut = 'active'
         AND tstzrange(debut, fin) && tstzrange($2::timestamptz, $3::timestamptz)
         AND ($5::int IS NULL OR id <> $5)
     ORDER BY debut`,
    [salleId, debut, fin, excludeSeanceId, excludeReservationId]);
  return rows;
}

async function assertRoomFree(client, salleId, debut, fin, opts) {
  const rows = await roomConflicts(client, salleId, debut, fin, opts);
  if (rows.length) throw conflict('Salle déjà occupée sur ce créneau', { conflits: rows });
}

/** Quantité disponible d'un équipement durable (total - demandes validées chevauchantes). */
async function availableQty(client, equipement, debut, fin, excludeDemandeId = null) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantite), 0)::int AS used FROM demandes_materiel
      WHERE equipement_id = $1 AND statut = 'validee'
        AND tstzrange(debut, fin) && tstzrange($2::timestamptz, $3::timestamptz)
        AND ($4::int IS NULL OR id <> $4)`,
    [equipement.id, debut, fin, excludeDemandeId]);
  return equipement.quantite - rows[0].used;
}

module.exports = { LOCK_SALLE, LOCK_EQUIP, lock, roomConflicts, assertRoomFree, availableQty };
