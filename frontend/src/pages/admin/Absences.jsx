import { useState } from 'react';
import { api, download, fmt } from '../../api';
import { Badge, Card, Modal, PageTitle, Table, useAction, useLoad } from '../../components/ui';

export default function Absences() {
  const run = useAction();
  const { data: justifs, reload } = useLoad(() => api('/admin/justificatifs'));
  const { data: feuilles } = useLoad(() => api('/admin/feuilles'));
  const [refus, setRefus] = useState(null);
  const [commentaire, setCommentaire] = useState('');

  const valider = async (j) => { await run(() => api(`/admin/justificatifs/${j.id}/valider`, { method: 'POST', body: {} }), 'Justificatif validé'); reload(); };
  const refuser = async (e) => {
    e.preventDefault();
    await run(() => api(`/admin/justificatifs/${refus.id}/refuser`, { method: 'POST', body: { commentaire } }), 'Justificatif refusé');
    setRefus(null); setCommentaire(''); reload();
  };

  return (
    <>
      <PageTitle>Absences & justificatifs</PageTitle>
      <Card title="Justificatifs d'absence">
        <Table rows={justifs} empty="Aucun justificatif" columns={[
          { label: 'Déposé le', render: (j) => fmt(j.created_at) }, { label: 'Étudiant', key: 'etudiant' },
          { label: 'Séance', render: (j) => `${j.module} (${fmt(j.debut)})` }, { label: 'Motif', key: 'motif' },
          { label: 'Fichier', render: (j) => <button className="text-brand-600 underline" onClick={() => run(() => download(`/justificatifs/${j.id}/fichier`, j.nom_original))}>{j.nom_original}</button> },
          { label: 'Statut', render: (j) => <Badge status={j.statut} /> },
          { label: 'Actions', render: (j) => j.statut === 'en_attente' && (
            <div className="flex gap-1">
              <button className="btn-success btn-sm" onClick={() => valider(j)}>Valider</button>
              <button className="btn-danger btn-sm" onClick={() => setRefus(j)}>Refuser</button>
            </div>) }]} />
      </Card>

      <Card title="Feuilles de présence transmises" className="mt-4">
        <Table rows={feuilles} empty="Aucune feuille transmise" columns={[
          { label: 'Séance', key: 'module' }, { label: 'Groupe', key: 'groupe' }, { label: 'Enseignant', key: 'enseignant' },
          { label: 'Date', render: (f) => fmt(f.debut) },
          { label: 'Présents', render: (f) => <Badge status="present">{f.presents}</Badge> },
          { label: 'Retards', render: (f) => <Badge status="retard">{f.retards}</Badge> },
          { label: 'Absents', render: (f) => <Badge status="absent">{f.absents}</Badge> },
          { label: 'Justifiés', render: (f) => <Badge status="absent_justifie">{f.justifies}</Badge> },
          { label: 'Transmise le', render: (f) => fmt(f.transmise_le) }]} />
      </Card>

      {refus && (
        <Modal title="Refuser le justificatif" onClose={() => setRefus(null)}>
          <form onSubmit={refuser}>
            <label className="block text-sm font-medium">Motif du refus
              <textarea className="input mt-1" rows={3} required maxLength={500} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRefus(null)}>Annuler</button>
              <button className="btn-danger">Refuser</button>
            </div>
          </form>
        </Modal>)}
    </>
  );
}
