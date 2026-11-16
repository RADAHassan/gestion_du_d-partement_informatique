import { useState } from 'react';
import { api, fmt } from '../../api';
import { Badge, Card, ErrorBox, Field, Modal, PageTitle, Stat, Table, useLoad, useToast } from '../../components/ui';

export default function Absences() {
  const { data: rows, reload } = useLoad(() => api('/etudiant/absences/mes'));
  const [target, setTarget] = useState(null);
  const count = (s) => (rows || []).filter((r) => r.statut === s).length;

  return (
    <>
      <PageTitle>Mes absences</PageTitle>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Présences" value={count('present')} />
        <Stat label="Retards" value={count('retard')} tone={count('retard') ? 'amber' : 'brand'} />
        <Stat label="Absences" value={count('absent')} tone={count('absent') ? 'red' : 'brand'} />
        <Stat label="Justifiées" value={count('absent_justifie')} />
      </div>
      <Card>
        <Table rows={rows} empty="Aucune présence enregistrée" columns={[
          { label: 'Séance', key: 'module' }, { label: 'Date', render: (r) => fmt(r.debut) }, { label: 'Statut', render: (r) => <Badge status={r.statut} /> },
          { label: 'Justificatif', render: (r) => (r.justificatif_statut
            ? <div><Badge status={r.justificatif_statut} />{r.justificatif_commentaire && <div className="mt-1 text-xs text-slate-500">{r.justificatif_commentaire}</div>}</div> : '—') },
          { label: '', render: (r) => r.statut === 'absent' && r.justificatif_statut !== 'en_attente' &&
            <button className="btn-primary btn-sm" onClick={() => setTarget(r)}>{r.justificatif_statut === 'refuse' ? 'Redéposer' : 'Justifier'}</button> }]} />
      </Card>
      {target && <UploadForm absence={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); reload(); }} />}
    </>
  );
}

const MAX = 5 * 1024 * 1024;

function UploadForm({ absence, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [motif, setMotif] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (f) => {
    setError('');
    if (f && !['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) { setError('Formats acceptés : PDF, JPEG, PNG'); setFile(null); return; }
    if (f && f.size > MAX) { setError('Fichier trop volumineux (5 Mo max)'); setFile(null); return; }
    setFile(f);
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const body = new FormData();
    body.append('motif', motif);
    body.append('fichier', file);
    try {
      await api(`/etudiant/absences/${absence.id}/justificatif`, { method: 'POST', body });
      toast('Justificatif déposé'); onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Déposer un justificatif" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-slate-600">{absence.module} — {fmt(absence.debut)}</p>
        <Field label="Motif"><textarea className="input" rows={2} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Certificat médical, convocation…" /></Field>
        <Field label="Fichier (PDF, JPEG ou PNG — 5 Mo max)">
          <input className="input" type="file" accept="application/pdf,image/jpeg,image/png" required onChange={(e) => pick(e.target.files[0])} />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" disabled={!file || busy}>Envoyer</button>
        </div>
      </form>
    </Modal>
  );
}
