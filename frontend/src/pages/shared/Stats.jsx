import { useState } from 'react';
import { api, download, toISO } from '../../api';
import { useAuth } from '../../auth';
import { Badge, Card, Field, PageTitle, Stat, Table, useAction, useLoad } from '../../components/ui';

/** Statistiques d'absentéisme : chef = tout le département, enseignant = ses séances. Export CSV (Excel). */
export default function Stats() {
  const { user } = useAuth();
  const run = useAction();
  const [f, setF] = useState({ from: '', to: '', groupe_id: '' });
  const params = {
    from: f.from ? toISO(`${f.from}T00:00`) : undefined,
    to: f.to ? toISO(`${f.to}T23:59`) : undefined,
    groupe_id: f.groupe_id || undefined,
  };
  const { data: rows } = useLoad(() => api('/stats/absences', { params }), [f.from, f.to, f.groupe_id]);
  const { data: groupes } = useLoad(() => (user.role === 'admin' ? api('/admin/groupes') : Promise.resolve([])));
  const sum = (k) => (rows || []).reduce((n, r) => n + r[k], 0);
  const total = sum('total');

  return (
    <>
      <PageTitle actions={<button className="btn-primary" onClick={() => run(() => download('/stats/absences/export', 'absences.csv', params), 'Export téléchargé')}>Exporter (CSV / Excel)</button>}>
        Statistiques d'absentéisme
      </PageTitle>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Présences" value={sum('presents')} />
        <Stat label="Retards" value={sum('retards')} tone={sum('retards') ? 'amber' : 'brand'} />
        <Stat label="Absences" value={sum('absents')} tone={sum('absents') ? 'red' : 'brand'} />
        <Stat label="Taux d'absence" value={`${total ? Math.round((sum('absents') / total) * 1000) / 10 : 0} %`} sub={`${rows ? rows.length : 0} étudiant(s)`} />
      </div>
      <Card title="Détail par étudiant">
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <Field label="Du"><input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Au"><input className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          {user.role === 'admin' && (
            <Field label="Groupe">
              <select className="input" value={f.groupe_id} onChange={(e) => setF({ ...f, groupe_id: e.target.value })}>
                <option value="">Tous les groupes</option>
                {(groupes || []).map((g) => <option key={g.id} value={g.id}>{g.filiere} — {g.nom}</option>)}
              </select>
            </Field>)}
        </div>
        <Table rows={rows} rowKey="etudiant_id" empty="Aucune présence enregistrée sur cette période" columns={[
          { label: 'Étudiant', render: (r) => `${r.nom} ${r.prenom}` }, { label: 'Filière', key: 'filiere' }, { label: 'Groupe', key: 'groupe' },
          { label: 'Séances', key: 'total' },
          { label: 'Présent', render: (r) => <Badge status="present">{r.presents}</Badge> },
          { label: 'Retards', render: (r) => <Badge status="retard">{r.retards}</Badge> },
          { label: 'Absences', render: (r) => <Badge status="absent">{r.absents}</Badge> },
          { label: 'Justifiées', render: (r) => <Badge status="absent_justifie">{r.justifies}</Badge> },
          { label: 'Taux', render: (r) => <b className={r.taux_absence >= 25 ? 'text-red-600' : ''}>{r.taux_absence} %</b> }]} />
      </Card>
    </>
  );
}
