import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, ErrorBox, Field, PageTitle, useLoad, useToast } from '../../components/ui';

const BOUNDS = { pointage_minutes: [1, 60], retard_minutes: [1, 60], seuil_absences: [1, 100] };
const LABELS = { pointage_minutes: 'Durée du code de pointage', retard_minutes: 'Délai avant « en retard »', seuil_absences: "Seuil d'alerte d'absences" };
const UNITS = { pointage_minutes: 'minutes', retard_minutes: 'minutes', seuil_absences: 'absences' };

/** Paramétrage des délais et seuils (EF-45) : modifiable par le chef de département uniquement (contrôlé côté serveur). */
export default function Parametres() {
  const toast = useToast();
  const { data, reload } = useLoad(() => api('/parametres'));
  const [vals, setVals] = useState({});
  const [error, setError] = useState('');

  useEffect(() => { if (data) setVals(Object.fromEntries(data.map((p) => [p.cle, p.valeur]))); }, [data]);

  const save = async (e) => {
    e.preventDefault(); setError('');
    const body = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v)]));
    try {
      await api('/parametres', { method: 'PUT', body });
      toast('Paramètres enregistrés');
      reload();
    } catch (err) { setError(err.message); }
  };

  return (
    <>
      <PageTitle>Paramètres</PageTitle>
      <Card title="Pointage et absences">
        {!data ? <p className="text-sm text-slate-500">Chargement…</p> : (
          <form onSubmit={save} className="max-w-xl">
            {data.map((p) => (
              <Field key={p.cle} label={`${LABELS[p.cle] || p.cle} (${UNITS[p.cle] || ''})`} hint={p.description}>
                <input className="input w-32" type="number" required min={BOUNDS[p.cle]?.[0]} max={BOUNDS[p.cle]?.[1]}
                  value={vals[p.cle] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [p.cle]: e.target.value }))} />
              </Field>))}
            <ErrorBox>{error}</ErrorBox>
            <button className="btn-primary mt-2">Enregistrer</button>
          </form>)}
      </Card>
    </>
  );
}
