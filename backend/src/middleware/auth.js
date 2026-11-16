const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { HttpError, h } = require('../utils/errors');

const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });

/** Vérifie le JWT (en-tête Authorization: Bearer) et recharge l'utilisateur (compte actif, rôle courant). */
const authenticate = h(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Authentification requise');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (_) {
    throw new HttpError(401, 'Jeton invalide ou expiré');
  }
  const { rows } = await query(
    'SELECT id, email, nom, prenom, role, groupe_id, actif FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user || !user.actif) throw new HttpError(401, 'Compte inexistant ou désactivé');
  req.user = user; // le rôle vient toujours de la base, jamais du jeton
  next();
});

/** RBAC strict côté serveur : 403 si le rôle n'est pas autorisé. */
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentification requise'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Accès interdit pour votre rôle'));
  next();
};

module.exports = { signToken, authenticate, requireRole };
