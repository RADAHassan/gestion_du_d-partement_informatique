import { useState } from 'react';
import { api, fmt, toISO } from '../../api';
import { Badge, Card, ErrorBox, Field, Modal, PageTitle, Table, useAction, useLoad } from '../../components/ui';

export default function Seances() {
  const run = useAction();
  const { data: seances, reload } = useLoad(() => api('/admin/seances'));
  const [creating, setCreating] = useState(false);

  const cancel = async (s) => {
    if (!window.confirm(`Annuler la séance « ${s.module} » ? La salle sera libérée.`)) return;
    await run(() => api(`/seances/${s.id}/annuler`, { method: 'POST' }), 'Séance annulée, salle libérée');
    reload();
  };

  return (
    <>
      <PageTitle actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ Planifier une séance</button>}>Planning des séances</PageTitle>
      <Card>
        <Table rows={seances} columns={[
          { label: 'Module', key: 'module' }, { label: 'Groupe', render: (s) => `${s.filiere} · ${s.groupe}` }, { label: 'Enseignant', key: 'enseignant' },
          { label: 'Salle', render: (s) => s.salle || '—' }, { label: 'Début', render: (s) => fmt(s.debut) }, { label: 'Fin', render: (s) => fmt(s.fin) },
          { label: 'Statut', render: (s) => <Badge status={s.statut} /> },
          { label: '', render: (s) => s.statut === 'planifiee' && !s.presence_validee && <button className="btn-danger btn-sm" onClick={() => cancel(s)}>Annuler</button> }]} />
      </Card>
      {creating && <SeanceForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </>
  );
}

function SeanceForm({ onClose, onSaved }) {
  const { data: users } = useLoad(() => api('/admin/users', { params: { role: 'enseignant' } }));
  const { data: groupes } = useLoad(() => api('/admin/groupes'));
  const { data: salles } = useLoad(() => api('/admin/salles'));
  const [v, setV] = useState({ module: '', enseignant_id: '', groupe_id: '', salle_id: '', debut: '', fin: '' });
  const [error, setError] = useState('');
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/admin/seances', { method: 'POST', body: {
        module: v.module, enseignant_id: +v.enseignant_id, groupe_id: +v.groupe_id, salle_id: +v.salle_id, debut: toISO(v.debut), fin: toISO(v.fin) } });
      onSaved();
    } catch (err) {
      const c = err.details?.conflits;
      setError(c ? `${err.message} : ${c.map((x) => x.libelle || x.module).join(', ')}` : err.message);
    }
  };
  const sel = (k, list, label) => (
    <select className="input" required value={v[k]} onChange={(e) => set(k, e.target.value)}>
      <option value="">— choisir —</option>{(list || []).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
    </select>);

  return (
    <Modal title="Planifier une séance" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Module"><input className="input" required value={v.module} onChange={(e) => set('module', e.target.value)} /></Field>
        <Field label="Enseignant">{sel('enseignant_id', users, (u) => `${u.prenom} ${u.nom}`)}</Field>
        <Field label="Groupe">{sel('groupe_id', groupes, (g) => `${g.filiere} · ${g.nom}`)}</Field>
        <Field label="Salle">{sel('salle_id', (salles || []).filter((s) => s.actif), (s) => `${s.nom} (${s.capacite} places)`)}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Début"><input className="input" type="datetime-local" required value={v.debut} onChange={(e) => set('debut', e.target.value)} /></Field>
          <Field label="Fin"><input className="input" type="datetime-local" required value={v.fin} onChange={(e) => set('fin', e.target.value)} /></Field>
        </div>
        <ErrorBox>{error}</ErrorBox>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary">Planifier</button>
        </div>
      </form>
    </Modal>
  );
}
