const { conflict, notFound } = require('../utils/errors');
const { isBelowThreshold } = require('./rules');

/**
 * Applique un mouvement de stock (entrée / sortie) de façon atomique, enregistre l'historique
 * et déclenche / résout automatiquement l'alerte de seuil minimal.
 */
async function applyMovement(client, { equipementId, type, quantite, motif = '', userId = null }) {
  const { rows } = await client.query('SELECT * FROM equipements WHERE id = $1 FOR UPDATE', [equipementId]);
  const eq = rows[0];
  if (!eq) throw notFound('Équipement introuvable');
  if (type === 'sortie' && quantite > eq.quantite) {
    throw conflict(`Stock insuffisant (${eq.quantite} disponible)`);
  }
  const newQty = type === 'entree' ? eq.quantite + quantite : eq.quantite - quantite;
  await client.query('UPDATE equipements SET quantite = $2 WHERE id = $1', [eq.id, newQty]);
  await client.query(
    'INSERT INTO mouvements_stock (equipement_id, type, quantite, motif, user_id) VALUES ($1,$2,$3,$4,$5)',
    [eq.id, type, quantite, motif, userId]);
  const alerte = await syncAlert(client, { ...eq, quantite: newQty });
  return { equipement: { ...eq, quantite: newQty }, alerte };
}

/** Crée une alerte si sous le seuil (et aucune active), la résout si le stock est revenu au-dessus. */
async function syncAlert(client, eq) {
  if (isBelowThreshold(eq.quantite, eq.seuil_min)) {
    const msg = `Stock sous le seuil minimal : ${eq.nom} (${eq.quantite} < ${eq.seuil_min})`;
    const { rows } = await client.query(
      `INSERT INTO alertes_stock (equipement_id, quantite, seuil_min, message)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (equipement_id) WHERE NOT resolue
       DO UPDATE SET quantite = EXCLUDED.quantite, message = EXCLUDED.message
       RETURNING *`,
      [eq.id, eq.quantite, eq.seuil_min, msg]);
    return rows[0];
  }
  await client.query(
    'UPDATE alertes_stock SET resolue = TRUE, resolue_le = now() WHERE equipement_id = $1 AND NOT resolue', [eq.id]);
  return null;
}

module.exports = { applyMovement, syncAlert };
