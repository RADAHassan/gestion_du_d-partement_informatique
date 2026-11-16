import { api, fmt } from '../../api';
import { Card, PageTitle, Table, useLoad } from '../../components/ui';

export default function Journal() {
  const { data, reload } = useLoad(() => api('/admin/journal', { params: { limit: 200 } }));
  return (
    <>
      <PageTitle actions={<button className="btn-secondary" onClick={reload}>Actualiser</button>}>Journal d'activité</PageTitle>
      <Card>
        <Table rows={data} columns={[
          { label: 'Date', render: (j) => fmt(j.created_at) }, { label: 'Utilisateur', render: (j) => j.utilisateur || '—' },
          { label: 'Action', key: 'action' }, { label: 'Détails', render: (j) => <code className="text-xs text-slate-600">{JSON.stringify(j.details)}</code> },
          { label: 'IP', key: 'ip' }]} />
      </Card>
    </>
  );
}
