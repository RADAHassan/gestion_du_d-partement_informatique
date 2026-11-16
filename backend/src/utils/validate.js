const { bad } = require('./errors');

/** Supprime toute balise HTML / caractères < > (défense XSS en profondeur ; React échappe aussi à l'affichage). */
function stripHtml(s) {
  return String(s)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<[^>]*>?/g, '')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

function str(v, name, { max = 255, required = true, min = 1 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Champ requis : ${name}`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${name} doit être une chaîne`);
  const clean = stripHtml(v);
  if (clean.length < min && required) throw bad(`${name} invalide`);
  if (clean.length > max) throw bad(`${name} trop long (max ${max})`);
  return clean;
}

function int(v, name, { min = -2147483648, max = 2147483647, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Champ requis : ${name}`);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} invalide`);
  return n;
}

function bool(v, name, { required = false, def = null } = {}) {
  if (v === undefined || v === null) {
    if (required) throw bad(`Champ requis : ${name}`);
    return def;
  }
  if (typeof v !== 'boolean') throw bad(`${name} doit être un booléen`);
  return v;
}

function oneOf(v, name, values, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Champ requis : ${name}`);
    return null;
  }
  if (!values.includes(v)) throw bad(`${name} doit être parmi : ${values.join(', ')}`);
  return v;
}

function date(v, name, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`Champ requis : ${name}`);
    return null;
  }
  const t = Date.parse(v);
  if (typeof v !== 'string' || Number.isNaN(t)) throw bad(`${name} n'est pas une date valide`);
  return new Date(t);
}

function period(body, { allowEqual = false } = {}) {
  const debut = date(body.debut, 'debut');
  const fin = date(body.fin, 'fin');
  if (allowEqual ? fin < debut : fin <= debut) throw bad('La fin doit être postérieure au début');
  return { debut, fin };
}

function email(v) {
  const e = str(v, 'email', { max: 190 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('email invalide');
  return e;
}

function password(v) {
  if (typeof v !== 'string' || v.length < 8 || v.length > 72) throw bad('Mot de passe : 8 à 72 caractères');
  return v;
}

/** Nettoie récursivement les chaînes d'un corps JSON (hors mots de passe). */
function sanitizeDeep(value, key = '') {
  if (typeof value === 'string') return /password/i.test(key) ? value : stripHtml(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v, k);
    return out;
  }
  return value;
}

module.exports = { stripHtml, str, int, bool, oneOf, date, period, email, password, sanitizeDeep };
