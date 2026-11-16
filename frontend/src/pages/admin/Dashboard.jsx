import { api, fmt } from '../../api';
import { Card, ErrorBox, PageTitle, Spinner, Stat, Table, useLoad } from '../../components/ui';

export default function Dashboard() {
  const { data: s, error } = useLoad(() => api('/admin/stats'));
  const { data: alertes } = useLoad(() => api('/admin/alertes'));
  const { data: feuilles } = useLoad(() => api('/admin/feuilles'));
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!s) return <Spinner />;
  const actives = (alertes || []).filter((a) => !a.resolue);

  return (
    <>
      <PageTitle>Tableau de bord</PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Étudiants" value={s.utilisateurs.etudiant || 0} />
        <Stat label="Enseignants" value={s.utilisateurs.enseignant || 0} />
        <Stat label="Séances aujourd'hui" value={s.seances_aujourdhui} />
        <Stat label="Salles occupées" value={`${s.salles_occupees}/${s.salles_total}`} sub="en ce moment" />
        <Stat label="Réservations à venir" value={s.reservations_a_venir} />
        <Stat label="Demandes matériel" value={s.demandes_en_attente} tone={s.demandes_en_attente ? 'amber' : 'brand'} sub="en attente" />
        <Stat label="Justificatifs" value={s.justificatifs_en_attente} tone={s.justificatifs_en_attente ? 'amber' : 'brand'} sub="à traiter" />
        <Stat label="Alertes de stock" value={s.alertes_stock} tone={s.alertes_stock ? 'red' : 'brand'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Assiduité">
          <div className="mb-3 flex items-end gap-6">
            <div><div className="text-3xl font-bold text-red-600">{s.taux_absence}%</div><div className="text-xs text-slate-500">taux d'absence</div></div>
            <div className="text-sm text-slate-600">
              {s.presences.presents} présences · {s.presences.absents} absences · {s.presences.justifies} justifiées
            </div>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            {s.presences.total > 0 && <>
              <div className="bg-emerald-500" style={{ width: `${(s.presences.presents / s.presences.total) * 100}%` }} />
              <div className="bg-blue-400" style={{ width: `${(s.presences.justifies / s.presences.total) * 100}%` }} />
              <div className="bg-red-500" style={{ width: `${(s.presences.absents / s.presences.total) * 100}%` }} />
            </>}
          </div>
          <h3 className="mb-1 mt-4 text-sm font-semibold">Étudiants les plus absents</h3>
          <Table columns={[{ label: 'Étudiant', key: 'etudiant' }, { label: 'Absences', key: 'absences' }]} rows={s.top_absents} rowKey="etudiant" empty="Aucune absence" />
        </Card>

        <Card title="Alertes de stock actives">
          <Table rows={actives} empty="Aucune alerte 🎉" columns={[
            { label: 'Équipement', key: 'equipement' }, { label: 'Stock', render: (a) => `${a.quantite} (min ${a.seuil_min})` },
            { label: 'Depuis', render: (a) => fmt(a.created_at) }]} />
        </Card>

        <Card title="Feuilles de présence transmises" className="lg:col-span-2">
          <Table rows={(feuilles || []).slice(0, 8)} empty="Aucune feuille transmise" columns={[
            { label: 'Séance', key: 'module' }, { label: 'Groupe', key: 'groupe' }, { label: 'Enseignant', key: 'enseignant' },
            { label: 'Date', render: (f) => fmt(f.debut) }, { label: 'Présents', key: 'presents' }, { label: 'Absents', key: 'absents' },
            { label: 'Justifiés', key: 'justifies' }, { label: 'Transmise le', render: (f) => fmt(f.transmise_le) }]} />
        </Card>
      </div>
    </>
  );
}
