import { useState } from 'react';
import { api, fmt, toISO, toLocalInput } from '../../api';
import { Badge, Card, ErrorBox, Field, Modal, PageTitle, Table, useAction, useLoad, useToast } from '../../components/ui';

const inHours = (h) => toLocalInput(new Date(Date.now() + h * 3600e3));

export default function Equipment() {
  const run = useAction();
  const [range, setRange] = useState({ debut: inHours(24), fin: inHours(26) });
  const valid = new Date(range.fin) > new Date(range.debut);
  const { data: items } = useLoad(
    () => api('/materiel', { params: valid ? { debut: toISO(range.debut), fin: toISO(range.fin) } : {} }), [range.debut, range.fin]);
  const { data: demandes, reload } = useLoad(() => api('/materiel/demandes/mes'));
  const [req, setReq] = useState(null);

  const cancel = async (d) => { await run(() => api(`/materiel/demandes/${d.id}`, { method: 'DELETE' }), 'Demande annulée'); reload(); };

  return (
    <>
      <PageTitle>Matériel</PageTitle>
      <Card title="Catalogue & disponibilité">
        <div className="mb-2 grid gap-3 sm:grid-cols-2">
          <Field label="Début d'emprunt"><input className="input" type="datetime-local" value={range.debut} onChange={(e) => setRange((r) => ({ ...r, debut: e.target.value }))} /></Field>
          <Field label="Fin d'emprunt"><input className="input" type="datetime-local" value={range.fin} onChange={(e) => setRange((r) => ({ ...r, fin: e.target.value }))} /></Field>
        </div>
        <Table rows={items} columns={[
          { label: 'Équipement', key: 'nom' }, { label: 'Catégorie', key: 'categorie' },
          { label: 'Type', render: (e) => <Badge color={e.type === 'durable' ? 'blue' : 'amber'}>{e.type === 'durable' ? 'Prêt' : 'Consommable'}</Badge> },
          { label: 'Disponible', render: (e) => <b className={e.disponible === 0 ? 'text-red-600' : ''}>{e.disponible}</b> },
          { label: '', render: (e) => <button className="btn-primary btn-sm" disabled={e.disponible === 0} onClick={() => setReq(e)}>Demander</button> }]} />
      </Card>

      <Card title="Mes demandes" className="mt-4">
        <Table rows={demandes} empty="Aucune demande" columns={[
          { label: 'Date', render: (d) => fmt(d.created_at) }, { label: 'Équipement', key: 'equipement' }, { label: 'Qté', key: 'quantite' },
          { label: 'Période', render: (d) => (d.equipement_type === 'durable' ? `${fmt(d.debut)} → ${fmt(d.fin)}` : '—') },
          { label: 'Statut', render: (d) => <Badge status={d.statut} /> },
          { label: '', render: (d) => ['en_attente', 'validee'].includes(d.statut) && !(d.statut === 'validee' && d.equipement_type === 'consommable') &&
            <button className="btn-danger btn-sm" onClick={() => cancel(d)}>Annuler</button> }]} />
      </Card>
      {req && <RequestForm item={req} range={range} onClose={() => setReq(null)} onDone={() => { setReq(null); reload(); }} />}
    </>
  );
}

function RequestForm({ item, range, onClose, onDone }) {
  const [quantite, setQuantite] = useState(1);
  const [motif, setMotif] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/materiel/demandes', { method: 'POST', body: {
        equipement_id: item.id, quantite: Number(quantite), motif, ...(item.type === 'durable' ? { debut: toISO(range.debut), fin: toISO(range.fin) } : {}) } });
      toast('Demande envoyée au chef de département');
      onDone();
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={`Demande — ${item.nom}`} onClose={onClose}>
      <form onSubmit={submit}>
        {item.type === 'durable' && <p className="mb-3 text-sm text-slate-600">Période : <b>{fmt(range.debut)}</b> → <b>{fmt(range.fin)}</b></p>}
        <Field label="Quantité" hint={`${item.disponible} disponible(s)`}>
          <input className="input" type="number" min="1" max={item.disponible} required value={quantite} onChange={(e) => setQuantite(e.target.value)} />
        </Field>
        <Field label="Motif"><input className="input" maxLength={255} value={motif} onChange={(e) => setMotif(e.target.value)} /></Field>
        <ErrorBox>{error}</ErrorBox>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary">Envoyer la demande</button>
        </div>
      </form>
    </Modal>
  );
}
