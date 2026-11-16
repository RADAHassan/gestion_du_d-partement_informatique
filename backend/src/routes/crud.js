const v = require('../utils/validate');
const { query } = require('../db');
const { h, notFound, bad } = require('../utils/errors');
const { log } = require('../services/journal');

function parseField(f, body) {
  const val = body[f.name];
  switch (f.type) {
    case 'str': return v.str(val, f.name, { max: f.max || 150, required: f.required !== false });
    case 'int': return v.int(val, f.name, { min: f.min, max: f.max, required: f.required !== false });
    case 'bool': return v.bool(val, f.name);
    case 'enum': return v.oneOf(val, f.name, f.values, { required: f.required !== false });
    default: throw new Error(`type inconnu ${f.type}`);
  }
}

/**
 * Fabrique de routes CRUD pour une table simple.
 * @param router  routeur Express
 * @param path    ex. '/salles'
 * @param table   nom de table SQL
 * @param fields  [{ name, type: 'str'|'int'|'bool'|'enum', required, max, min, values, def }]
 * @param opts    { listSql, entity }
 */
function crud(router, path, table, fields, { listSql, entity = table, afterWrite } = {}) {
  router.get(path, h(async (_req, res) => {
    const { rows } = await query(listSql || `SELECT * FROM ${table} ORDER BY id`);
    res.json(rows);
  }));

  router.get(`${path}/:id`, h(async (req, res) => {
    const id = v.int(req.params.id, 'id');
    const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound();
    res.json(rows[0]);
  }));

  router.post(path, h(async (req, res) => {
    const cols = []; const vals = [];
    for (const f of fields) {
      let val = parseField(f, req.body || {});
      if ((val === null || val === undefined) && f.def !== undefined) val = f.def;
      if (val === null || val === undefined) continue;
      cols.push(f.name); vals.push(val);
    }
    if (!cols.length) throw bad('Corps vide');
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals);
    if (afterWrite) await afterWrite(rows[0]);
    await log(req, `${entity}.create`, entity, { id: rows[0].id });
    res.status(201).json(rows[0]);
  }));

  router.put(`${path}/:id`, h(async (req, res) => {
    const id = v.int(req.params.id, 'id');
    const sets = []; const vals = [];
    for (const f of fields) {
      if ((req.body || {})[f.name] === undefined) continue;
      vals.push(parseField(f, req.body)); sets.push(`${f.name} = $${vals.length}`);
    }
    if (!sets.length) throw bad('Aucun champ à modifier');
    vals.push(id);
    const { rows } = await query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) throw notFound();
    if (afterWrite) await afterWrite(rows[0]);
    await log(req, `${entity}.update`, entity, { id });
    res.json(rows[0]);
  }));

  router.delete(`${path}/:id`, h(async (req, res) => {
    const id = v.int(req.params.id, 'id');
    const { rowCount } = await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    if (!rowCount) throw notFound();
    await log(req, `${entity}.delete`, entity, { id });
    res.status(204).end();
  }));
}

module.exports = { crud };
