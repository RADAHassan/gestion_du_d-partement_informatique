import { useState } from 'react';
import { api, fmt } from '../../api';
import { Badge, Card, PageTitle, Table, useAction, useLoad } from '../../components/ui';

export default function Demandes() {
  const run = useAction();
  const [statut, setStatut] = useState('en_attente');
  const { data, reload } = useLoad(() => api('/admin/demandes', { params: { statut } }), [statut]);

  const act = async (d, action, msg) => { await run(() => api(`/admin/demandes/${d.id}/${action}`, { method: 'POST' }), msg); reload(); };

  return (
    <>
      <PageTitle>Demandes de matériel</PageTitle>
      <Card actions={
        <select className="input w-auto" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Filtrer par statut">
          <option value="">Toutes</option><option value="en_attente">En attente</option><option value="validee">Validées</option>
          <option value="refusee">Refusées</option><option value="retournee">Retournées</option><option value="annulee">Annulées</option>
        </select>}>
        <Table rows={data} empty="Aucune demande" columns={[
          { label: 'Date', render: (d) => fmt(d.created_at) }, { label: 'Enseignant', key: 'enseignant' }, { label: 'Équipement', key: 'equipement' },
          { label: 'Qté', key: 'quantite' },
          { label: 'Période', render: (d) => (d.equipement_type === 'durable' ? `${fmt(d.debut)} → ${fmt(d.fin)}` : 'Consommable') },
          { label: 'Motif', key: 'motif' }, { label: 'Statut', render: (d) => <Badge status={d.statut} /> },
          { label: 'Actions', render: (d) => (
            <div className="flex gap-1">
              {d.statut === 'en_attente' && <>
                <button className="btn-success btn-sm" onClick={() => act(d, 'valider', 'Demande validée')}>Valider</button>
                <button className="btn-danger btn-sm" onClick={() => act(d, 'refuser', 'Demande refusée')}>Refuser</button></>}
              {d.statut === 'validee' && d.equipement_type === 'durable' &&
                <button className="btn-secondary btn-sm" onClick={() => act(d, 'retour', 'Matériel retourné')}>Marquer retourné</button>}
            </div>) }]} />
      </Card>
    </>
  );
}
