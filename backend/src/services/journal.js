const { pool } = require('../db');

/** Enregistre une action dans le journal d'activité (n'interrompt jamais la requête en cas d'échec). */
async function log(req, action, entite, details = {}, client = pool) {
  try {
    await client.query(
      'INSERT INTO journal (user_id, action, entite, details, ip) VALUES ($1, $2, $3, $4, $5)',
      [req.user ? req.user.id : null, action, entite, JSON.stringify(details), req.ip]);
  } catch (e) {
    console.error('journal:', e.message);
  }
}

module.exports = { log };
