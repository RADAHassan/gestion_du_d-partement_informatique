// Chargé avant chaque fichier de test : configure l'environnement de l'API.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL
  || 'postgres://postgres:postgres@localhost:5432/dept_info_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123456';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'dept-info-test-uploads');
