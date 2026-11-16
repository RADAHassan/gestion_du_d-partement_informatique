const config = require('../config');
const { HttpError } = require('../utils/errors');
const { sanitizeDeep } = require('../utils/validate');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protection CSRF.
 * 1) L'authentification repose sur un jeton Bearer envoyé explicitement dans l'en-tête
 *    Authorization (jamais sur un cookie) : un site tiers ne peut donc pas l'émettre.
 * 2) En défense en profondeur, toute requête modifiante portant un en-tête Origin
 *    non autorisé est rejetée, et les corps doivent être du JSON ou du multipart.
 */
function csrfGuard(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) {
    return next(new HttpError(403, 'Origine non autorisée (CSRF)'));
  }
  const type = req.headers['content-type'] || '';
  const hasBody = Number(req.headers['content-length'] || 0) > 0;
  if (hasBody && !/^(application\/json|multipart\/form-data)/i.test(type)) {
    return next(new HttpError(415, 'Content-Type non supporté'));
  }
  next();
}

/** Nettoie les chaînes entrantes (XSS stocké). */
function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = sanitizeDeep(req.body);
  next();
}

module.exports = { csrfGuard, sanitizeBody };
