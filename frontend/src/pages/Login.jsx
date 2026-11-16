import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorBox } from '../components/ui';

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={`/${user.role}`} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email.trim(), password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-600 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h1 className="text-center text-xl font-bold text-brand-900">Département Informatique</h1>
        <p className="mb-5 text-center text-sm text-slate-500">Faculté des Sciences et Techniques de Tanger</p>
        <label className="mb-3 block text-sm font-medium">Adresse e-mail
          <input className="input mt-1" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="mb-4 block text-sm font-medium">Mot de passe
          <input className="input mt-1" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorBox>{error}</ErrorBox>
        <button className="btn-primary mt-3 w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}
