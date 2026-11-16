import { useState } from 'react';
import { api, fmt } from '../../api';
import { useAuth } from '../../auth';
import { Badge, Card, ErrorBox, Field, PageTitle, Table, useAction, useLoad, useToast } from '../../components/ui';

/** Signalement de panne (tous les rôles). Le chef de département voit tout et clôture. */
export default function Pannes() {
  const { user } = useAuth();
  const run = useAction();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const canListEquip = user.role !== 'etudiant'; // /materiel est réservé à l'admin et aux enseignants (côté serveur aussi)
  const { data: pannes, reload } = useLoad(() => api('/pannes'));
  const { data: salles } = useLoad(() => api('/salles'));
  const { data: equipements } = useLoad(() => (canListEquip ? api('/materiel') : Promise.resolve([])));
  const [form, setForm] = useState({ cible: '', description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    const [kind, id] = form.cible.split(':');
    if (!id) { setError('Choisissez la salle ou l\'équipement concerné.'); return; }
    setBusy(true);
    try {
      await api('/pannes', { method: 'POST', body: { [kind === 'salle' ? 'salle_id' : 'equipement_id']: Number(id), description: form.description } });
      toast('Panne signalée — le chef de département est prévenu');
      setForm({ cible: '', description: '' }); reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const resolve = async (p) => { await run(() => api(`/pannes/${p.id}/resoudre`, { method: 'POST' }), 'Panne marquée comme résolue'); reload(); };

  return (
    <>
      <PageTitle>Pannes</PageTitle>
      <Card title="Signaler une panne" className="mb-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Salle ou équipement concerné">
            <select className="input" value={form.cible} onChange={(e) => setForm((f) => ({ ...f, cible: e.target.value }))} required>
              <option value="">— Choisir —</option>
              <optgroup label="Salles">{(salles || []).map((s) => <option key={`s${s.id}`} value={`salle:${s.id}`}>{s.nom}</option>)}</optgroup>
              {canListEquip && <optgroup label="Équipements">{(equipements || []).map((q) => <option key={`e${q.id}`} value={`equipement:${q.id}`}>{q.nom}</option>)}</optgroup>}
            </select>
          </Field>
          <Field label="Description du problème">
            <input className="input" required maxLength={500} value={form.description} placeholder="Le vidéoprojecteur ne s'allume pas…"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className="sm:col-span-2"><ErrorBox>{error}</ErrorBox></div>
          <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>Signaler</button></div>
        </form>
      </Card>

      <Card title={isAdmin ? 'Toutes les pannes' : 'Mes signalements'}>
        <Table rows={pannes} empty="Aucune panne signalée" columns={[
          { label: 'Date', render: (p) => fmt(p.created_at) },
          { label: 'Concerné', render: (p) => p.equipement || p.salle },
          { label: 'Description', key: 'description' },
          ...(isAdmin ? [{ label: 'Signalée par', key: 'signale_par' }] : []),
          { label: 'Statut', render: (p) => <Badge status={p.statut} /> },
          ...(isAdmin ? [{ label: '', render: (p) => p.statut === 'ouverte' && <button className="btn-success btn-sm" onClick={() => resolve(p)}>Marquer résolue</button> }] : [])]} />
      </Card>
    </>
  );
}
