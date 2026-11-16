import { api, fmt } from '../../api';
import { Card, PageTitle, useAction, useLoad } from '../../components/ui';

/** Notifications de l'utilisateur connecté (le serveur ne renvoie que les siennes). */
export default function Notifications() {
  const run = useAction();
  const { data: list, reload } = useLoad(() => api('/notifications', { params: { limit: 100 } }));

  const read = async (n) => {
    if (n.lu) return;
    await run(() => api(`/notifications/${n.id}/lue`, { method: 'POST' }));
    reload();
    window.dispatchEvent(new Event('notifications-changed'));
  };
  const readAll = async () => {
    await run(() => api('/notifications/lues', { method: 'POST' }), 'Tout est marqué comme lu');
    reload();
    window.dispatchEvent(new Event('notifications-changed'));
  };
  const unread = (list || []).filter((n) => !n.lu).length;

  return (
    <>
      <PageTitle actions={<button className="btn-secondary" disabled={!unread} onClick={readAll}>Tout marquer comme lu</button>}>
        Notifications {unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 align-middle text-xs text-white">{unread}</span>}
      </PageTitle>
      <Card>
        {!list ? <p className="text-sm text-slate-500">Chargement…</p> : !list.length ? <p className="text-sm text-slate-500">Aucune notification.</p> : (
          <ul className="divide-y divide-slate-100">
            {list.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => read(n)}
                  className={`flex w-full items-start gap-3 px-1 py-3 text-left text-sm hover:bg-slate-50 ${n.lu ? 'text-slate-500' : 'font-medium text-slate-900'}`}>
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.lu ? 'bg-transparent' : 'bg-brand-600'}`} />
                  <span className="flex-1">{n.message}</span>
                  <span className="shrink-0 text-xs font-normal text-slate-400">{fmt(n.created_at)}</span>
                </button>
              </li>))}
          </ul>)}
      </Card>
    </>
  );
}
