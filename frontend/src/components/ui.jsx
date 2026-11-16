import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ------------------------------------------------------------------ Toasts
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'ok') => {
    const id = Math.random();
    setItems((l) => [...l, { id, message, type }]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm text-white shadow-lg ${t.type === 'err' ? 'bg-red-600' : 'bg-emerald-600'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Exécute une action async avec toast succès / erreur. */
export function useAction() {
  const toast = useToast();
  return useCallback(async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, 'err'); return undefined; }
  }, [toast]);
}

/** Charge des données avec rechargement manuel. */
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => fn().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)).finally(() => setLoading(false)), deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

// -------------------------------------------------------------- Composants
export const PageTitle = ({ children, actions }) => (
  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
    <h1 className="text-xl font-bold text-slate-900">{children}</h1>
    <div className="flex gap-2">{actions}</div>
  </div>
);

export const Card = ({ title, children, className = '', actions }) => (
  <section className={`card ${className}`}>
    {(title || actions) && (
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">{title}</h2>{actions}
      </div>
    )}
    {children}
  </section>
);

const COLORS = {
  green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800', gray: 'bg-slate-100 text-slate-700',
};
const STATUS_COLOR = {
  present: 'green', valide: 'green', validee: 'green', active: 'green', ouvert: 'green', planifiee: 'blue', libre: 'green',
  absent: 'red', refuse: 'red', refusee: 'red', annulee: 'gray', cloture: 'gray', terminee: 'gray', retournee: 'gray', occupee: 'red',
  en_attente: 'amber', absent_justifie: 'blue',
};
const STATUS_LABEL = {
  present: 'Présent', absent: 'Absent', absent_justifie: 'Absence justifiée', en_attente: 'En attente', valide: 'Validé',
  validee: 'Validée', refuse: 'Refusé', refusee: 'Refusée', annulee: 'Annulée', planifiee: 'Planifiée', terminee: 'Terminée',
  retournee: 'Retournée', ouvert: 'Ouvert', cloture: 'Clôturé', active: 'Active', libre: 'Libre', occupee: 'Occupée',
};
export const Badge = ({ status, children, color }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[color || STATUS_COLOR[status] || 'gray']}`}>
    {children || STATUS_LABEL[status] || status}
  </span>
);

export function Table({ columns, rows, empty = 'Aucune donnée', rowKey = 'id' }) {
  if (!rows) return <p className="text-sm text-slate-500">Chargement…</p>;
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead><tr>{columns.map((c) => <th key={c.key || c.label} className="th">{c.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} className="hover:bg-slate-50">
              {columns.map((c) => <td key={c.key || c.label} className="td">{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={`my-8 w-full rounded-xl bg-white p-5 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="mb-3 block text-sm">
    <span className="mb-1 block font-medium text-slate-700">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
  </label>
);

export const Stat = ({ label, value, tone = 'brand', sub }) => (
  <div className="card">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 text-3xl font-bold ${tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-brand-700'}`}>{value}</div>
    {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
  </div>
);

export const Spinner = () => <p className="p-6 text-center text-sm text-slate-500">Chargement…</p>;
export const ErrorBox = ({ children }) => children ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{children}</p> : null;
