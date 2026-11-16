const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const v = require('../utils/validate');
const config = require('../config');
const { query } = require('../db');
const { h, HttpError } = require('../utils/errors');
const { signToken, authenticate } = require('../middleware/auth');
const { log } = require('../services/journal');

const router = express.Router();

// Anti brute-force sur le login (désactivé en test pour ne pas bloquer la suite)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 10000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard' },
});

// Hash factice : on compare toujours, pour ne pas révéler l'existence d'un compte par le temps de réponse
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

router.post('/login', loginLimiter, h(async (req, res) => {
  const email = v.email((req.body || {}).email);
  const password = (req.body || {}).password;
  if (typeof password !== 'string' || !password) throw new HttpError(400, 'Mot de passe requis');
  const { rows } = await query(
    'SELECT id, email, nom, prenom, role, groupe_id, actif, password_hash FROM users WHERE lower(email) = $1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !user.actif || !ok) {
    await log({ user: null, ip: req.ip }, 'auth.echec', 'users', { email });
    throw new HttpError(401, 'Identifiants invalides');
  }
  await log({ user, ip: req.ip }, 'auth.login', 'users', {});
  const safe = { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, role: user.role, groupe_id: user.groupe_id };
  res.json({ token: signToken(user), user: safe });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;
