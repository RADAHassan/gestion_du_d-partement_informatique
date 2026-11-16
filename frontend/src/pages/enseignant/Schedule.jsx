import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, fmt, fmtDay, fmtTime } from '../../api';
import { Badge, Card, Modal, PageTitle, Spinner, Table, useAction, useLoad } from '../../components/ui';

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function Schedule() {
  const run = useAction();
  const { data: seances, reload } = useLoad(() => api('/seances/mes', { params: { from: startOfToday() } }));
  const [active, setActive] = useState(null);

  const cancel = async (s) => {
    if (!window.confirm(`Annuler la séance « ${s.module} » du ${fmt(s.debut)} ? La salle sera libérée.`)) return;
    await run(() => api(`/seances/${s.id}/annuler`, { method: 'POST' }), 'Séance annulée — salle libérée');
    reload();
  };

  const byDay = (seances || []).reduce((acc, s) => { (acc[fmtDay(s.debut)] ||= []).push(s); return acc; }, {});

  return (
    <>
      <PageTitle>Mon emploi du temps & pointage</PageTitle>
      {!seances ? <Spinner /> : !seances.length ? <Card>Aucune séance à venir.</Card> : Object.entries(byDay).map(([day, list]) => (
        <Card key={day} title={<span className="capitalize">{day}</span>} className="mb-4">
          <Table rows={list} columns={[
            { label: 'Horaire', render: (s) => `${fmtTime(s.debut)} – ${fmtTime(s.fin)}` }, { label: 'Module', key: 'module' },
            { label: 'Groupe', key: 'groupe' }, { label: 'Salle', render: (s) => s.salle || '—' },
            { label: 'Statut', render: (s) => (
              <div className="flex gap-1">
                <Badge status={s.statut} />
                {s.pointage_statut === 'ouvert' && <Badge status="ouvert">Pointage ouvert</Badge>}
                {s.presence_validee && <Badge color="green">Feuille transmise</Badge>}
              </div>) },
            { label: 'Actions', render: (s) => s.statut !== 'annulee' && (
              <div className="flex gap-1">
                <button className="btn-primary btn-sm" onClick={() => setActive(s)}>{s.presence_validee ? 'Voir la feuille' : 'Pointage'}</button>
                {s.statut === 'planifiee' && !s.presence_validee && <button className="btn-danger btn-sm" onClick={() => cancel(s)}>Annuler</button>}
              </div>) }]} />
        </Card>))}
      {active && <PointagePanel seance={active} onClose={() => { setActive(null); reload(); }} />}
    </>
  );
}

function Countdown({ expireLe }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(expireLe) - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(expireLe) - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [expireLe]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0'); const ss = String(left % 60).padStart(2, '0');
  return <span className={left < 60 ? 'text-red-600' : 'text-slate-900'}>{mm}:{ss}</span>;
}

function PointagePanel({ seance, onClose }) {
  const run = useAction();
  const { data: f, reload } = useLoad(() => api(`/seances/${seance.id}/pointage`), [seance.id]);
  const [minutes, setMinutes] = useState(15);
  const open = f?.pointage?.statut === 'ouvert';

  // durée par défaut = paramètre réglé par le chef de département
  useEffect(() => {
    api('/parametres').then((ps) => {
      const p = ps.find((x) => x.cle === 'pointage_minutes');
      if (p) setMinutes(Number(p.valeur));
    }).catch(() => {});
  }, []);
  const validated = f?.seance?.presence_validee;

  // actualisation en direct des présences tant que le pointage est ouvert
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [open, reload]);

  const post = async (path, msg, body) => { await run(() => api(`/seances/${seance.id}/${path}`, { method: 'POST', body }), msg); reload(); };
  const correct = async (etu, statut) => {
    await run(() => api(`/seances/${seance.id}/presences/${etu.etudiant_id}`, { method: 'PUT', body: { statut } }), 'Correction enregistrée');
    reload();
  };

  const counts = (f?.etudiants || []).reduce((c, e) => { c[e.statut || 'attente'] = (c[e.statut || 'attente'] || 0) + 1; return c; }, {});

  return (
    <Modal title={`Pointage — ${seance.module} (${seance.groupe})`} onClose={onClose} wide>
      {!f ? <Spinner /> : (
        <>
          {open ? (
            <div className="mb-4 flex flex-wrap items-center gap-6 rounded-xl bg-brand-50 p-4">
              <QRCodeSVG value={f.pointage.code} size={112} />
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Code de séance</div>
                <div className="font-mono text-4xl font-bold tracking-widest text-brand-900" aria-label="Code de pointage">{f.pointage.code}</div>
                <div className="mt-1 text-sm">Expire dans <b className="font-mono"><Countdown expireLe={f.pointage.expire_le} /></b></div>
              </div>
              <button className="btn-danger ml-auto" onClick={() => post('pointage/fermer', 'Pointage clôturé : les non-pointés sont absents')}>Clôturer maintenant</button>
            </div>
          ) : !validated && (
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-slate-100 p-4">
              <label className="text-sm font-medium">Durée de validité (min)
                <input className="input mt-1 w-28" type="number" min="1" max="60" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
              </label>
              <button className="btn-primary" onClick={() => post('pointage/ouvrir', 'Pointage ouvert', { duree_minutes: minutes })}>
                {f.pointage ? 'Rouvrir le pointage' : 'Ouvrir le pointage'}
              </button>
              {f.pointage && <Badge status="cloture">Pointage clôturé</Badge>}
            </div>
          )}

          <div className="mb-2 flex flex-wrap gap-2 text-sm">
            <Badge status="present">{counts.present || 0} présent(s)</Badge>
            <Badge status="retard">{counts.retard || 0} en retard</Badge>
            <Badge status="absent">{counts.absent || 0} absent(s)</Badge>
            {open && <Badge status="en_attente">{counts.attente || 0} en attente</Badge>}
          </div>
          <Table rows={f.etudiants} rowKey="etudiant_id" columns={[
            { label: 'Étudiant', render: (e) => `${e.nom} ${e.prenom}` },
            { label: 'Statut', render: (e) => (e.statut ? <Badge status={e.statut} /> : <Badge status="en_attente">Non pointé</Badge>) },
            { label: 'Source', render: (e) => ({ etudiant: 'Pointage', auto: 'Automatique', manuel: 'Correction manuelle' }[e.source] || '—') },
            { label: 'Heure', render: (e) => (e.pointe_le ? fmtTime(e.pointe_le) : '—') },
            { label: 'Correction', render: (e) => !validated && (
              <div className="flex gap-1">
                <button className="btn-secondary btn-sm" disabled={e.statut === 'present'} onClick={() => correct(e, 'present')}>Présent</button>
                <button className="btn-secondary btn-sm" disabled={e.statut === 'retard'} onClick={() => correct(e, 'retard')}>Retard</button>
                <button className="btn-secondary btn-sm" disabled={e.statut === 'absent'} onClick={() => correct(e, 'absent')}>Absent</button>
              </div>) }]} />

          {!validated && f.pointage && (
            <div className="mt-4 flex justify-end">
              <button className="btn-success" onClick={() => window.confirm('Valider la feuille et la transmettre au chef de département ?') && post('valider', 'Feuille validée et transmise au chef de département')}>
                Valider & transmettre la feuille
              </button>
            </div>)}
          {validated && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Feuille validée et transmise le {fmt(f.seance.transmise_le)}.</p>}
        </>)}
    </Modal>
  );
}
