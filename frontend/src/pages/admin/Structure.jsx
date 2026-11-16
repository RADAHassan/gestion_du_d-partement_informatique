import CrudPanel from '../../components/CrudPanel';
import { PageTitle } from '../../components/ui';

const CYCLES = [{ name: 'nom', label: 'Nom du cycle', type: 'text' }];
const FILIERES = [
  { name: 'nom', label: 'Nom de la filière', type: 'text' },
  { name: 'cycle_id', label: 'Cycle', type: 'select', ref: { path: '/cycles', label: 'nom' } },
];
const GROUPES = [
  { name: 'nom', label: 'Nom du groupe', type: 'text' },
  { name: 'filiere_id', label: 'Filière', type: 'select', ref: { path: '/filieres', label: 'nom' } },
];

export default function Structure() {
  return (
    <>
      <PageTitle>Cycles, filières et groupes</PageTitle>
      <div className="grid gap-4 xl:grid-cols-3">
        <CrudPanel title="Cycles" path="/cycles" fields={CYCLES} columns={[{ label: 'Cycle', key: 'nom' }]} />
        <CrudPanel title="Filières" path="/filieres" fields={FILIERES} columns={[{ label: 'Filière', key: 'nom' }, { label: 'Cycle', key: 'cycle' }]} />
        <CrudPanel title="Groupes" path="/groupes" fields={GROUPES} columns={[{ label: 'Groupe', key: 'nom' }, { label: 'Filière', key: 'filiere' }]} />
      </div>
    </>
  );
}
