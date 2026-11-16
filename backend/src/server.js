const config = require('./config');
const app = require('./app');
const { pool } = require('./db');
const { closeExpired } = require('./services/pointage');

const server = app.listen(config.port, () => {
  console.log(`API démarrée sur le port ${config.port} (${config.isProd ? 'production' : 'développement'})`);
});

// Clôture automatique des pointages expirés (les non-pointés deviennent absents)
const timer = setInterval(() => {
  closeExpired().catch((e) => console.error('closeExpired:', e.message));
}, 30 * 1000);

function shutdown() {
  clearInterval(timer);
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
