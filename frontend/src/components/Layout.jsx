import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const NAV = {
  admin: [
    ['/admin', 'Tableau de bord', true], ['/admin/comptes', 'Comptes'], ['/admin/structure', 'Cycles · Filières · Groupes'],
    ['/admin/salles', 'Salles'], ['/admin/seances', 'Planning des séances'], ['/admin/materiel', 'Matériel & stock'],
    ['/admin/demandes', 'Demandes de matériel'], ['/admin/absences', 'Absences & justificatifs'], ['/admin/statistiques', 'Statistiques & export'],
    ['/admin/pannes', 'Pannes'], ['/admin/notifications', 'Notifications'], ['/admin/parametres', 'Paramètres'], ['/admin/journal', "Journal d'activité"],
  ],
  enseignant: [
    ['/enseignant', 'Emploi du temps & pointage', true], ['/enseignant/salles', 'Salles & réservations'], ['/enseignant/materiel', 'Matériel'],
    ['/enseignant/statistiques', 'Statistiques & export'], ['/enseignant/pannes', 'Pannes'], ['/enseignant/notifications', 'Notifications'],
  ],
  etudiant: [
    ['/etudiant', 'Emploi du temps & pointage', true], ['/etudiant/absences', 'Mes absences'],
    ['/etudiant/pannes', 'Pannes'], ['/etudiant/notifications', 'Notifications'],
  ],
};
const ROLE_LABEL = { admin: 'Chef de département', enseignant: 'Enseignant', etudiant: 'Étudiant' };

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // compteur de notifications non lues : rafraîchi toutes les 30 s et après chaque lecture
  const refresh = useCallback(() => {
    api('/notifications/non-lues').then((r) => setUnread(r.non_lues)).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    window.addEventListener('notifications-changed', refresh);
    return () => { clearInterval(t); window.removeEventListener('notifications-changed', refresh); };
  }, [refresh]);

  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between bg-brand-900 px-4 py-3 text-white md:hidden">
        <span className="font-semibold">FST Tanger · Dép. Informatique</span>
        <button className="rounded px-2 py-1 hover:bg-white/10" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>☰</button>
      </header>
      <aside className={`${open ? 'block' : 'hidden'} w-full shrink-0 bg-brand-900 text-white md:block md:min-h-screen md:w-64`}>
        <div className="hidden px-5 py-5 md:block">
          <div className="text-lg font-bold leading-tight">Département Informatique</div>
          <div className="text-xs text-blue-200">FST Tanger</div>
        </div>
        <nav className="flex flex-col gap-1 px-3 pb-3 md:py-2" aria-label="Navigation principale">
          {NAV[user.role].map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
              className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold' : 'text-blue-100 hover:bg-white/10'}`}>
              <span className="flex items-center justify-between gap-2">
                {label}
                {to.endsWith('/notifications') && unread > 0 && (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${unread} non lues`}>{unread}</span>)}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-sm md:mt-4">
          <div className="font-medium">{user.prenom} {user.nom}</div>
          <div className="mb-2 text-xs text-blue-200">{ROLE_LABEL[user.role]}</div>
          <button className="btn bg-white/10 text-white hover:bg-white/20" onClick={logout}>Se déconnecter</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8"><Outlet /></main>
    </div>
  );
}
