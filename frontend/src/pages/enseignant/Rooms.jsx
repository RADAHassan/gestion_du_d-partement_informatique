import { useState } from 'react';
import { api, fmt, toISO, toLocalInput } from '../../api';
import { Badge, Card, ErrorBox, Field, PageTitle, Table, useAction, useLoad, useToast } from '../../components/ui';

const inHours = (h) => toLocalInput(new Date(Date.now() + h * 3600e3));

export default function Rooms() {
  const run = useAction();
  const toast = useToast();
  const [range, setRange] = useState({ debut: inHours(24), fin: inHours(26) });
  const [motif, setMotif] = useState('');
  const [error, setError] = useState('');
  const valid = range.debut && range.fin && new Date(range.fin) > new Date(range.debut);
  const { data: dispo, reload: reloadDispo } = useLoad(
    () => (valid ? api('/salles/disponibilites', { params: { debut: toISO(range.debut), fin: toISO(range.fin) } }) : Promise.resolve(null)),
    [range.debut, range.fin]);
  const { data: mes, reload: reloadMes } = useLoad(() => api('/reservations'));

  const reserver = async (salle) => {
    setError('');
    try {
      await api('/reservations', { method: 'POST', body: { salle_id: salle.id, debut: toISO(range.debut), fin: toISO(range.fin), motif } });
      toast(`${salle.nom} réservée`);
    } catch (e) {
      setError(e.status === 409 ? `Conflit : ${salle.nom} est déjà occupée sur ce créneau.` : e.message);
    }
    reloadDispo(); reloadMes();
  };
  const annuler = async (r) => {
    await run(() => api(`/reservations/${r.id}`, { method: 'DELETE' }), 'Réservation annulée — salle libérée');
    reloadDispo(); reloadMes();
  };

  return (
    <>
      <PageTitle>Salles & réservations</PageTitle>
      <Card title="Rechercher et réserver une salle libre">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Début"><input className="input" type="datetime-local" value={range.debut} onChange={(e) => setRange((r) => ({ ...r, debut: e.target.value }))} /></Field>
          <Field label="Fin"><input className="input" type="datetime-local" value={range.fin} onChange={(e) => setRange((r) => ({ ...r, fin: e.target.value }))} /></Field>
          <Field label="Motif"><input className="input" maxLength={255} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Rattrapage, soutenance…" /></Field>
        </div>
        {!valid && <ErrorBox>La fin doit être postérieure au début.</ErrorBox>}
        <ErrorBox>{error}</ErrorBox>
        {dispo && <Table rows={dispo} columns={[
          { label: 'Salle', key: 'nom' }, { label: 'Type', key: 'type' }, { label: 'Capacité', key: 'capacite' },
          { label: 'État', render: (s) => <Badge status={s.libre ? 'libre' : 'occupee'} /> },
          { label: 'Occupation', render: (s) => s.occupations.map((o) => `${o.libelle || o.type} ${fmt(o.debut)}→${fmt(o.fin)}`).join(' ; ') || '—' },
          { label: '', render: (s) => <button className="btn-primary btn-sm" disabled={!s.libre} onClick={() => reserver(s)}>Réserver</button> }]} />}
      </Card>

      <Card title="Mes réservations" className="mt-4">
        <Table rows={mes} empty="Aucune réservation" columns={[
          { label: 'Salle', key: 'salle' }, { label: 'Début', render: (r) => fmt(r.debut) }, { label: 'Fin', render: (r) => fmt(r.fin) },
          { label: 'Motif', key: 'motif' }, { label: 'Statut', render: (r) => <Badge status={r.statut} /> },
          { label: '', render: (r) => r.statut === 'active' && new Date(r.fin) > new Date() && <button className="btn-danger btn-sm" onClick={() => annuler(r)}>Annuler</button> }]} />
      </Card>
    </>
  );
}
