import React, { useState } from 'react';
import { invitePlatformCourtUser } from '../../services/platformCourtService';
import type { UserRole } from '../../types';

type Props = {
  courtId: string;
  onInvited: () => void;
};

export default function PlatformInviteUserForm({ courtId, onInvited }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('123456');
  const [role, setRole] = useState<UserRole>('clerk');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await invitePlatformCourtUser(courtId, {
        email: email.trim(),
        name: name.trim(),
        password: password.trim(),
        role,
      });
      setOk(`Usuario ${res.email} invitado (${res.role}).`);
      setEmail('');
      setName('');
      onInvited();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 max-w-lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block sm:col-span-2">
          <span className="text-xs font-bold text-slate-500 uppercase">Email *</span>
          <input className="input-modern mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-500 uppercase">Nombre</span>
          <input className="input-modern mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-500 uppercase">Contraseña temporal</span>
          <input className="input-modern mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-bold text-slate-500 uppercase">Rol</span>
          <select className="input-modern mt-1" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="admin">Administrador</option>
            <option value="judge">Juez</option>
            <option value="clerk">Secretario(a)</option>
            <option value="official">Oficial mayor</option>
            <option value="sustanciador">Sustanciador(a)</option>
            <option value="escribiente">Escribiente</option>
            <option value="asistente_judicial">Asistente judicial</option>
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && <p className="text-sm text-green-700">{ok}</p>}
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"
      >
        {saving ? 'Invitando…' : 'Invitar usuario'}
      </button>
    </form>
  );
}
