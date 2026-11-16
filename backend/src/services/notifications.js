/**
 * Notifications internes (le cahier des charges prévoit aussi l'e-mail : ce service est le canal de repli,
 * un envoi SMTP pourra s'y brancher sans toucher aux appelants).
 * Les messages sont du texte brut construit côté serveur ; React les échappe à l'affichage.
 */
const { pool } = require('../db');

const clip = (m) => String(m).slice(0, 500);

/** Notifie une liste d'utilisateurs (ids). */
async function notify(userIds, message, client = pool) {
  const ids = [...new Set((userIds || []).filter(Number.isInteger))];
  if (!ids.length) return 0;
  const r = await client.query(
    'INSERT INTO notifications (user_id, message) SELECT unnest($1::int[]), $2', [ids, clip(message)]);
  return r.rowCount;
}

/** Notifie tous les comptes actifs d'un rôle (ex. le chef de département). */
async function notifyRole(role, message, client = pool) {
  const r = await client.query(
    "INSERT INTO notifications (user_id, message) SELECT id, $2 FROM users WHERE role = $1::role_t AND actif",
    [role, clip(message)]);
  return r.rowCount;
}

/** Notifie les étudiants actifs d'un groupe. */
async function notifyGroupe(groupeId, message, client = pool) {
  const r = await client.query(
    "INSERT INTO notifications (user_id, message) SELECT id, $2 FROM users WHERE groupe_id = $1 AND role = 'etudiant' AND actif",
    [groupeId, clip(message)]);
  return r.rowCount;
}

/** À utiliser APRÈS un commit : une notification ratée ne doit jamais faire échouer la requête. */
const safe = (promise) => promise.catch((e) => console.error('notification:', e.message));

module.exports = { notify, notifyRole, notifyGroupe, safe };
