import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

const NAV = {
  admin: [
    ['/admin', 'Tableau de bord', true], ['/admin/comptes', 'Comptes'], ['/admin/structure', 'Cycles · Filières · Groupes'],
    ['/admin/salles', 'Salles'], ['/admin/seances', 'Planning des séances'], ['/admin/materiel', 'Matériel & stock'],
    ['/admin/demandes', 'Demandes de matériel'], ['/admin/absences', 'Absences & justificatifs'], ['/admin/journal', "Journal d'activité"],
  ],
  enseignant: [
    ['/enseignant', 'Emploi du temps & pointage', true], ['/enseignant/salles', 'Salles & réservations'], ['/enseignant/materiel', 'Matériel'],
  ],
  etudiant: [['/etudiant', 'Emploi du temps & pointage', true], ['/etudiant/absences', 'Mes absences']],
};
const ROLE_LABEL = { admin: 'Chef de département', enseignant: 'Enseignant', etudiant: 'Étudiant' };

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
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
              {label}
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
