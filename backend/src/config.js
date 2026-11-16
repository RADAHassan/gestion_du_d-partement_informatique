require('dotenv').config();
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /CHANGE_?ME/i.test(process.env.JWT_SECRET))) {
  throw new Error('JWT_SECRET (>= 32 caractères, différent du modèle .env.example) est obligatoire en production : openssl rand -hex 32');
}

module.exports = {
  isProd,
  isTest: process.env.NODE_ENV === 'test',
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/dept_info',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  // origines autorisées pour les requêtes cross-origin (liste séparée par des virgules)
  allowedOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:8080')
    .split(',').map((s) => s.trim()).filter(Boolean),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  maxUploadBytes: 5 * 1024 * 1024,
  pointageDefaultMinutes: parseInt(process.env.POINTAGE_MINUTES || '15', 10),
  bcryptRounds: 10,
};
