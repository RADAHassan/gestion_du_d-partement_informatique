import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Field, Modal, Table, useAction, useLoad } from './ui';

/**
 * Panneau CRUD générique pour l'administration.
 * fields : [{ name, label, type: 'text'|'number'|'select'|'checkbox', options?, ref?: {path, label}, required?, def? }]
 * columns : colonnes du tableau (clé = champ de la ligne renvoyée par l'API)
 * extraActions(row, reload) : boutons supplémentaires par ligne
 */
export default function CrudPanel({ title, path, columns, fields, extraActions, canDelete = true }) {
  const run = useAction();
  const { data: rows, reload } = useLoad(() => api(`/admin${path}`), [path]);
  const [refs, setRefs] = useState({});
  const [editing, setEditing] = useState(null); // null | {} (création) | row

  useEffect(() => {
    fields.filter((f) => f.ref).forEach((f) => {
      api(`/admin${f.ref.path}`).then((list) => setRefs((r) => ({ ...r, [f.name]: list.map((x) => ({ value: x.id, label: x[f.ref.label] })) })));
    });
  }, [fields]);

  const save = async (values) => {
    const body = {};
    for (const f of fields) {
      let v = values[f.name];
      if (f.type === 'number' && v !== '' && v !== undefined && v !== null) v = Number(v);
      if (f.type === 'select' && f.ref && v) v = Number(v);
      if (v === '' || v === undefined) continue;
      body[f.name] = v;
    }
    const ok = await run(() => api(`/admin${path}${values.id ? `/${values.id}` : ''}`, { method: values.id ? 'PUT' : 'POST', body }),
      values.id ? 'Modifié' : 'Créé');
    if (ok) { setEditing(null); reload(); }
  };

  const remove = async (row) => {
    if (!window.confirm('Supprimer cet élément ?')) return;
    await run(() => api(`/admin${path}/${row.id}`, { method: 'DELETE' }), 'Supprimé');
    reload();
  };

  const cols = [...columns, {
    label: 'Actions',
    render: (r) => (
      <div className="flex flex-wrap gap-1">
        {extraActions && extraActions(r, reload)}
        <button className="btn-secondary btn-sm" onClick={() => setEditing(r)}>Modifier</button>
        {canDelete && <button className="btn-danger btn-sm" onClick={() => remove(r)}>Supprimer</button>}
      </div>
    ),
  }];

  return (
    <Card title={title} actions={<button className="btn-primary btn-sm" onClick={() => setEditing({})}>+ Ajouter</button>}>
      <Table columns={cols} rows={rows} />
      {editing && <FormModal title={editing.id ? `Modifier — ${title}` : `Ajouter — ${title}`} fields={fields} refs={refs}
        initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </Card>
  );
}

function FormModal({ title, fields, refs, initial, onClose, onSave }) {
  const [v, setV] = useState(() => {
    const o = { id: initial.id };
    fields.forEach((f) => { o[f.name] = initial[f.name] ?? f.def ?? (f.type === 'checkbox' ? true : ''); });
    return o;
  });
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
        {fields.map((f) => (
          <Field key={f.name} label={f.label}>
            {f.type === 'select' ? (
              <select className="input" required={f.required !== false} value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— choisir —</option>
                {(f.options || refs[f.name] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            ) : (
              <input className="input" type={f.type} required={f.required !== false} min={f.type === 'number' ? 0 : undefined}
                value={v[f.name]} onChange={(e) => set(f.name, e.target.value)} />
            )}
          </Field>
        ))}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
