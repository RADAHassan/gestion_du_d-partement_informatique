import { useState } from 'react';
import { api } from '../../api';
import { Badge, Card, Field, Modal, PageTitle, Table, useAction, useLoad } from '../../components/ui';

const ROLES = { admin: 'Chef de département', enseignant: 'Enseignant', etudiant: 'Étudiant' };

export default function Users() {
  const run = useAction();
  const [role, setRole] = useState('');
  const { data: users, reload } = useLoad(() => api('/admin/users', { params: { role } }), [role]);
  const { data: groupes } = useLoad(() => api('/admin/groupes'));
  const [editing, setEditing] = useState(null);

  const toggle = async (u) => { await run(() => api(`/admin/users/${u.id}`, { method: 'PUT', body: { actif: !u.actif } }), u.actif ? 'Compte désactivé' : 'Compte activé'); reload(); };
  const remove = async (u) => {
    if (!window.confirm(`Supprimer le compte de ${u.prenom} ${u.nom} ?`)) return;
    await run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), 'Compte supprimé'); reload();
  };

  return (
    <>
      <PageTitle actions={<button className="btn-primary" onClick={() => setEditing({ role: 'etudiant' })}>+ Nouveau compte</button>}>Gestion des comptes</PageTitle>
      <Card actions={
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filtrer par rôle">
          <option value="">Tous les rôles</option>
          {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>}>
        <Table rows={users} columns={[
          { label: 'Nom', render: (u) => `${u.prenom} ${u.nom}` }, { label: 'E-mail', key: 'email' },
          { label: 'Rôle', render: (u) => ROLES[u.role] }, { label: 'Groupe', render: (u) => (u.groupe ? `${u.filiere} · ${u.groupe}` : '—') },
          { label: 'Statut', render: (u) => <Badge color={u.actif ? 'green' : 'gray'}>{u.actif ? 'Actif' : 'Désactivé'}</Badge> },
          { label: 'Actions', render: (u) => (
            <div className="flex gap-1">
              <button className="btn-secondary btn-sm" onClick={() => setEditing(u)}>Modifier</button>
              <button className="btn-secondary btn-sm" onClick={() => toggle(u)}>{u.actif ? 'Désactiver' : 'Activer'}</button>
              <button className="btn-danger btn-sm" onClick={() => remove(u)}>Supprimer</button>
            </div>) }]} />
      </Card>
      {editing && <UserForm user={editing} groupes={groupes || []} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function UserForm({ user, groupes, onClose, onSaved }) {
  const run = useAction();
  const [v, setV] = useState({ nom: '', prenom: '', email: '', password: '', groupe_id: '', ...user });
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const submit = async (e) => {
    e.preventDefault();
    const body = { nom: v.nom, prenom: v.prenom, email: v.email, role: v.role };
    if (v.password) body.password = v.password;
    if (v.role === 'etudiant') body.groupe_id = Number(v.groupe_id);
    const ok = await run(() => api(user.id ? `/admin/users/${user.id}` : '/admin/users', { method: user.id ? 'PUT' : 'POST', body }), 'Enregistré');
    if (ok) onSaved();
  };
  return (
    <Modal title={user.id ? 'Modifier le compte' : 'Nouveau compte'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prénom"><input className="input" required value={v.prenom} onChange={(e) => set('prenom', e.target.value)} /></Field>
          <Field label="Nom"><input className="input" required value={v.nom} onChange={(e) => set('nom', e.target.value)} /></Field>
        </div>
        <Field label="E-mail"><input className="input" type="email" required value={v.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Rôle">
          <select className="input" value={v.role} onChange={(e) => set('role', e.target.value)}>
            {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {v.role === 'etudiant' && (
          <Field label="Groupe">
            <select className="input" required value={v.groupe_id ?? ''} onChange={(e) => set('groupe_id', e.target.value)}>
              <option value="">— choisir —</option>
              {groupes.map((g) => <option key={g.id} value={g.id}>{g.filiere} · {g.nom}</option>)}
            </select>
          </Field>)}
        <Field label="Mot de passe" hint={user.id ? 'Laisser vide pour ne pas le changer' : '8 caractères minimum'}>
          <input className="input" type="password" autoComplete="new-password" minLength={8} required={!user.id} value={v.password} onChange={(e) => set('password', e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
