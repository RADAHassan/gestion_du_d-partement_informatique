class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const bad = (m, d) => new HttpError(400, m, d);
const notFound = (m = 'Ressource introuvable') => new HttpError(404, m);
const conflict = (m, d) => new HttpError(409, m, d);
const forbidden = (m = 'Accès interdit') => new HttpError(403, m);

/** Enveloppe un handler async pour transmettre les erreurs à Express. */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, bad, notFound, conflict, forbidden, h };
