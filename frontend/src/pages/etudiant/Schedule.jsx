import { useState } from 'react';
import { api, fmtDay, fmtTime } from '../../api';
import { Badge, Card, ErrorBox, PageTitle, Spinner, Table, useLoad, useToast } from '../../components/ui';

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function Schedule() {
  const toast = useToast();
  const { data: seances, reload } = useLoad(() => api('/seances/mes', { params: { from: startOfToday() } }));
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pointer = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const r = await api('/etudiant/pointage', { method: 'POST', body: { code: code.trim() } });
      toast(r.deja_pointe ? `Déjà pointé : ${r.module}`
        : r.statut === 'retard' ? `Présence enregistrée en retard : ${r.module}` : `Présence enregistrée : ${r.module}`);
      setCode(''); reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const byDay = (seances || []).reduce((acc, s) => { (acc[fmtDay(s.debut)] ||= []).push(s); return acc; }, {});
  const ouvertes = (seances || []).filter((s) => s.pointage_statut === 'ouvert' && !s.ma_presence);

  return (
    <>
      <PageTitle>Mon emploi du temps</PageTitle>
      <Card title="Pointer ma présence" className="mb-4">
        <form onSubmit={pointer} className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">Code affiché par l'enseignant
            <input className="input mt-1 w-48 text-center font-mono text-xl uppercase tracking-widest" maxLength={10} required autoComplete="off"
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A7K3PQ" />
          </label>
          <button className="btn-primary" disabled={busy || !code}>Valider ma présence</button>
        </form>
        <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>
        {ouvertes.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            ⏱ Pointage ouvert : {ouvertes.map((s) => s.module).join(', ')} — saisissez le code avant l'expiration.
          </p>)}
      </Card>

      {!seances ? <Spinner /> : !seances.length ? <Card>Aucune séance à venir.</Card> : Object.entries(byDay).map(([day, list]) => (
        <Card key={day} title={<span className="capitalize">{day}</span>} className="mb-4">
          <Table rows={list} columns={[
            { label: 'Horaire', render: (s) => `${fmtTime(s.debut)} – ${fmtTime(s.fin)}` }, { label: 'Module', key: 'module' },
            { label: 'Enseignant', key: 'enseignant' }, { label: 'Salle', render: (s) => s.salle || '—' },
            { label: 'Statut', render: (s) => <Badge status={s.statut} /> },
            { label: 'Ma présence', render: (s) => (s.ma_presence ? <Badge status={s.ma_presence} /> : '—') }]} />
        </Card>))}
    </>
  );
}
