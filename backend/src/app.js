const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { authenticate, requireRole } = require('./middleware/auth');
const { csrfGuard, sanitizeBody } = require('./middleware/security');
const { HttpError } = require('./utils/errors');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(csrfGuard);
app.use(sanitizeBody);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', require('./routes/auth'));

const etudiant = require('./routes/etudiant');
// tout ce qui suit exige un utilisateur authentifié
app.use('/api', authenticate);
app.use('/api/admin', requireRole('admin'), require('./routes/admin')); // RBAC strict : admin uniquement
app.use('/api/etudiant', etudiant.requireStudent, etudiant.student);
app.use('/api', etudiant.files);
app.use('/api', require('./routes/salles'));
app.use('/api', require('./routes/seances'));
app.use('/api', require('./routes/materiel'));
app.use('/api', require('./routes/transversal'));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route introuvable')));

// ---------------------------------------------------------------- Erreurs
const PG_ERRORS = {
  '23P01': [409, 'Conflit : créneau ou ressource déjà occupé(e)'],
  '23505': [409, 'Cette valeur existe déjà'],
  '23503': [409, 'Opération impossible : élément lié à d\'autres données'],
  '23514': [400, 'Données invalides (contrainte non respectée)'],
  '23502': [400, 'Champ obligatoire manquant'],
  '22P02': [400, 'Format de donnée invalide'],
  '22003': [400, 'Valeur numérique hors limites'],
};

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.message;
  if (err.type === 'entity.parse.failed') { status = 400; message = 'JSON invalide'; }
  if (err.type === 'entity.too.large') { status = 413; message = 'Requête trop volumineuse'; }
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'Fichier trop volumineux (5 Mo max)'; }
  if (err.code && PG_ERRORS[err.code]) [status, message] = PG_ERRORS[err.code];
  if (status >= 500) {
    console.error(err);
    message = 'Erreur interne du serveur'; // aucun détail technique exposé
  }
  res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
});

module.exports = app;
