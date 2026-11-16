import { useState } from 'react';
import { api, fmt, toISO } from '../../api';
import CrudPanel from '../../components/CrudPanel';
import { Badge, Card, Field, PageTitle, Table, useLoad } from '../../components/ui';

const FIELDS = [
  { name: 'nom', label: 'Nom', type: 'text' },
  { name: 'type', label: 'Type', type: 'select', options: [{ value: 'cours', label: 'Salle de cours' }, { value: 'tp', label: 'Salle de TP' }, { value: 'amphi', label: 'Amphithéâtre' }] },
  { name: 'capacite', label: 'Capacité', type: 'number' },
  { name: 'actif', label: 'Active', type: 'checkbox' },
];

export default function Salles() {
  const [range, setRange] = useState({ debut: '', fin: '' });
  const { data: dispo } = useLoad(
    () => (range.debut && range.fin ? api('/salles/disponibilites', { params: { debut: toISO(range.debut), fin: toISO(range.fin) } }) : Promise.resolve(null)),
    [range.debut, range.fin]);

  return (
    <>
      <PageTitle>Salles</PageTitle>
      <CrudPanel title="Inventaire des salles" path="/salles" fields={FIELDS} columns={[
        { label: 'Nom', key: 'nom' }, { label: 'Type', key: 'type' }, { label: 'Capacité', key: 'capacite' },
        { label: 'Statut', render: (s) => <Badge color={s.actif ? 'green' : 'gray'}>{s.actif ? 'Active' : 'Inactive'}</Badge> }]} />
      <Card title="Disponibilité sur un créneau" className="mt-4">
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field label="Début"><input className="input" type="datetime-local" value={range.debut} onChange={(e) => setRange((r) => ({ ...r, debut: e.target.value }))} /></Field>
          <Field label="Fin"><input className="input" type="datetime-local" value={range.fin} onChange={(e) => setRange((r) => ({ ...r, fin: e.target.value }))} /></Field>
        </div>
        {dispo && <Table rows={dispo} columns={[
          { label: 'Salle', key: 'nom' },
          { label: 'État', render: (s) => <Badge status={s.libre ? 'libre' : 'occupee'} /> },
          { label: 'Occupée par', render: (s) => s.occupations.map((o) => `${o.libelle || o.type} (${fmt(o.debut)} → ${fmt(o.fin)})`).join(' ; ') || '—' }]} />}
      </Card>
    </>
  );
}
