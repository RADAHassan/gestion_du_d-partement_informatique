import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsers from './pages/admin/Users';
import AdminStructure from './pages/admin/Structure';
import AdminSalles from './pages/admin/Salles';
import AdminSeances from './pages/admin/Seances';
import AdminMateriel from './pages/admin/Materiel';
import AdminDemandes from './pages/admin/Demandes';
import AdminAbsences from './pages/admin/Absences';
import AdminJournal from './pages/admin/Journal';
import TeacherSchedule from './pages/enseignant/Schedule';
import TeacherRooms from './pages/enseignant/Rooms';
import TeacherEquipment from './pages/enseignant/Equipment';
import StudentSchedule from './pages/etudiant/Schedule';
import StudentAbsences from './pages/etudiant/Absences';
import AdminParametres from './pages/admin/Parametres';
import Notifications from './pages/shared/Notifications';
import Pannes from './pages/shared/Pannes';
import Stats from './pages/shared/Stats';

/** Garde de route : l'interface masque ce qui n'est pas autorisé (le serveur reste l'autorité). */
function Protected({ role }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={`/${user.role}`} replace />;
  return <Layout />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<Protected role="admin" />}>
        <Route index element={<AdminDashboard />} />
        <Route path="comptes" element={<AdminUsers />} />
        <Route path="structure" element={<AdminStructure />} />
        <Route path="salles" element={<AdminSalles />} />
        <Route path="seances" element={<AdminSeances />} />
        <Route path="materiel" element={<AdminMateriel />} />
        <Route path="demandes" element={<AdminDemandes />} />
        <Route path="absences" element={<AdminAbsences />} />
        <Route path="statistiques" element={<Stats />} />
        <Route path="pannes" element={<Pannes />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="parametres" element={<AdminParametres />} />
        <Route path="journal" element={<AdminJournal />} />
      </Route>
      <Route path="/enseignant" element={<Protected role="enseignant" />}>
        <Route index element={<TeacherSchedule />} />
        <Route path="salles" element={<TeacherRooms />} />
        <Route path="materiel" element={<TeacherEquipment />} />
        <Route path="statistiques" element={<Stats />} />
        <Route path="pannes" element={<Pannes />} />
        <Route path="notifications" element={<Notifications />} />
      </Route>
      <Route path="/etudiant" element={<Protected role="etudiant" />}>
        <Route index element={<StudentSchedule />} />
        <Route path="absences" element={<StudentAbsences />} />
        <Route path="pannes" element={<Pannes />} />
        <Route path="notifications" element={<Notifications />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? `/${user.role}` : '/login'} replace />} />
    </Routes>
  );
}
