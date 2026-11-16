/**
 * Règles métier pures (sans accès base) - facilement testables unitairement.
 */
const crypto = require('crypto');

/** Deux périodes [debut, fin[ se chevauchent-elles ? (bornes adjacentes = pas de conflit) */
function overlaps(a, b) {
  return new Date(a.debut) < new Date(b.fin) && new Date(b.debut) < new Date(a.fin);
}

/** Renvoie les éléments de `existing` en conflit avec `candidate`. */
function findConflicts(candidate, existing) {
  return existing.filter((e) => overlaps(candidate, e));
}

/** Étudiants à marquer absents à la clôture : inscrits au groupe et sans présence enregistrée. */
function computeAbsentees(groupStudentIds, presentIds) {
  const present = new Set(presentIds);
  return groupStudentIds.filter((id) => !present.has(id));
}

/** Une alerte est déclenchée quand le stock passe strictement sous le seuil minimal. */
function isBelowThreshold(quantite, seuilMin) {
  return seuilMin > 0 && quantite < seuilMin;
}

/** Quantité disponible d'un équipement durable sur une période. */
function availableQuantity(total, validatedRequests, period) {
  const used = validatedRequests
    .filter((r) => overlaps(r, period))
    .reduce((s, r) => s + r.quantite, 0);
  return total - used;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1
function generateCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

module.exports = { overlaps, findConflicts, computeAbsentees, isBelowThreshold, availableQuantity, generateCode };
