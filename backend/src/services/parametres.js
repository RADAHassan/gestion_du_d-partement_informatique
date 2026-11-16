/** Paramètres métier modifiables par le chef de département (table `parametres`). */
const { pool } = require('../db');
const config = require('../config');

// bornes de validation + valeur de repli si la ligne est absente
const DEFS = {
  pointage_minutes: { min: 1, max: 60, def: () => config.pointageDefaultMinutes },
  retard_minutes: { min: 1, max: 60, def: () => 5 },
  seuil_absences: { min: 1, max: 100, def: () => 3 },
};

async function getAll(client = pool) {
  const { rows } = await client.query('SELECT cle, valeur, description FROM parametres ORDER BY cle');
  return rows;
}

async function getInt(cle, client = pool) {
  const { rows } = await client.query('SELECT valeur FROM parametres WHERE cle = $1', [cle]);
  const n = rows[0] ? parseInt(rows[0].valeur, 10) : NaN;
  return Number.isInteger(n) ? n : DEFS[cle].def();
}

module.exports = { DEFS, getAll, getInt };
