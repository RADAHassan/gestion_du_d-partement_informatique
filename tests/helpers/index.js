const fs = require('fs');
const path = require('path');
const request = require('supertest');

const ROOT = path.resolve(__dirname, '..', '..');
const app = require(path.join(ROOT, 'backend', 'src', 'app'));
const { pool } = require(path.join(ROOT, 'backend', 'src', 'db'));

const ACCOUNTS = {
  admin: ['admin@fsttanger.ma', 'Admin@1234'],
  prof1: ['prof1@fsttanger.ma', 'Prof@1234'],
  prof2: ['prof2@fsttanger.ma', 'Prof@1234'],
  prof3: ['prof3@fsttanger.ma', 'Prof@1234'],
  etu1: ['etudiant1@etu.fsttanger.ma', 'Etud@1234'],
  etu2: ['etudiant2@etu.fsttanger.ma', 'Etud@1234'],
  etu3: ['etudiant3@etu.fsttanger.ma', 'Etud@1234'],
  etu4: ['etudiant4@etu.fsttanger.ma', 'Etud@1234'],
  etu5: ['etudiant5@etu.fsttanger.ma', 'Etud@1234'],
};

/** Recrée la base (schéma + jeu de données) : chaque fichier de test démarre d'un état connu. */
async function resetDb() {
  for (const f of ['schema.sql', 'seed.sql']) {
    await pool.query(fs.readFileSync(path.join(ROOT, 'database', f), 'utf8'));
  }
  Object.keys(tokens).forEach((k) => delete tokens[k]);
}

const tokens = {};
/** Connecte les comptes demandés (à appeler dans beforeAll après resetDb). */
async function loginAll(...whos) {
  for (const who of whos) {
    const [email, password] = ACCOUNTS[who];
    const res = await request(app).post('/api/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login ${who} -> ${res.status} ${JSON.stringify(res.body)}`);
    tokens[who] = res.body.token;
  }
}

/** Client authentifié : as('prof1').post('/api/...').send({...}) */
const as = (who) => {
  if (!tokens[who]) throw new Error(`appelez loginAll('${who}') avant as('${who}')`);
  const auth = (t) => t.set('Authorization', `Bearer ${tokens[who]}`);
  return {
    token: tokens[who],
    get: (u) => auth(request(app).get(u)),
    post: (u) => auth(request(app).post(u)),
    put: (u) => auth(request(app).put(u)),
    delete: (u) => auth(request(app).delete(u)),
  };
};

/** Date relative (UTC) : dans `days` jours à `hour` heures (décimales = fractions d'heure). */
function at(days, hour = 8) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d.toISOString();
}

const idOf = async (sql, params = []) => (await pool.query(sql, params)).rows[0].id;
const close = () => pool.end();

module.exports = { app, pool, request, resetDb, loginAll, as, at, idOf, close, ACCOUNTS };
