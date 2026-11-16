import { useState } from 'react';
import { api, fmt } from '../../api';
import CrudPanel from '../../components/CrudPanel';
import { Badge, Card, Field, Modal, PageTitle, Table, useAction, useLoad } from '../../components/ui';

const FIELDS = [
  { name: 'nom', label: 'Désignation', type: 'text' },
  { name: 'categorie', label: 'Catégorie', type: 'text', required: false },
  { name: 'type', label: 'Type', type: 'select', options: [{ value: 'durable', label: 'Durable (prêt)' }, { value: 'consommable', label: 'Consommable (stock)' }] },
  { name: 'quantite', label: 'Quantité / stock', type: 'number' },
  { name: 'seuil_min', label: 'Seuil minimal (alerte)', type: 'number' },
  { name: 'actif', label: 'Actif', type: 'checkbox' },
];

export default function Materiel() {
  const [move, setMove] = useState(null);
  const [tick, setTick] = useState(0);
  const { data: alertes, reload: reloadAlertes } = useLoad(() => api('/admin/alertes'));
  const { data: mouvements, reload: reloadMouv } = useLoad(() => api('/admin/mouvements', { params: { limit: 15 } }));

  const refresh = () => { setTick((t) => t + 1); reloadAlertes(); reloadMouv(); };
  const actives = (alertes || []).filter((a) => !a.resolue);

  return (
    <>
      <PageTitle>Matériel & stock</PageTitle>
      {actives.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <div className="font-semibold text-red-800">⚠ {actives.length} alerte(s) de stock</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-700">{actives.map((a) => <li key={a.id}>{a.message}</li>)}</ul>
        </div>
      )}
      <CrudPanel key={tick} title="Inventaire" path="/equipements" fields={FIELDS} columns={[
        { label: 'Désignation', key: 'nom' }, { label: 'Catégorie', key: 'categorie' },
        { label: 'Type', render: (e) => <Badge color={e.type === 'durable' ? 'blue' : 'amber'}>{e.type}</Badge> },
        { label: 'Quantité', render: (e) => <span className={e.type === 'consommable' && e.quantite < e.seuil_min ? 'font-bold text-red-600' : ''}>{e.quantite}</span> },
        { label: 'Seuil', key: 'seuil_min' }]}
      extraActions={(e) => (
        <>
          <button className="btn-success btn-sm" onClick={() => setMove({ eq: e, type: 'entree' })}>＋ Entrée</button>
          <button className="btn-secondary btn-sm" onClick={() => setMove({ eq: e, type: 'sortie' })}>－ Sortie</button>
        </>)} />
      <Card title="Derniers mouvements de stock" className="mt-4">
        <Table rows={mouvements} columns={[
          { label: 'Date', render: (m) => fmt(m.created_at) }, { label: 'Équipement', key: 'equipement' },
          { label: 'Mouvement', render: (m) => <Badge color={m.type === 'entree' ? 'green' : 'amber'}>{m.type === 'entree' ? 'Entrée' : 'Sortie'}</Badge> },
          { label: 'Qté', key: 'quantite' }, { label: 'Motif', key: 'motif' }, { label: 'Par', render: (m) => m.utilisateur || '—' }]} />
      </Card>
      {move && <MovementForm {...move} onClose={() => setMove(null)} onDone={() => { setMove(null); refresh(); }} />}
    </>
  );
}

function MovementForm({ eq, type, onClose, onDone }) {
  const run = useAction();
  const [quantite, setQuantite] = useState(1);
  const [motif, setMotif] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => api(`/admin/equipements/${eq.id}/mouvements`, { method: 'POST', body: { type, quantite: Number(quantite), motif } }),
      type === 'entree' ? 'Entrée enregistrée' : 'Sortie enregistrée');
    if (r) onDone();
  };
  return (
    <Modal title={`${type === 'entree' ? 'Entrée' : 'Sortie'} de stock — ${eq.nom}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-slate-600">Stock actuel : <b>{eq.quantite}</b> (seuil minimal : {eq.seuil_min})</p>
        <Field label="Quantité"><input className="input" type="number" min="1" required value={quantite} onChange={(e) => setQuantite(e.target.value)} /></Field>
        <Field label="Motif"><input className="input" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Réapprovisionnement, casse, usage…" /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary">Valider</button>
        </div>
      </form>
    </Modal>
  );
}
