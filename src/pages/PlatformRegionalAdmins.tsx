import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Trash2, Users } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useTenant } from '../contexts/TenantContext';
import {
  fetchJudicialCatalogs,
  fetchRegionalAdmins,
  grantRegionalAdmin,
  revokeRegionalAdmin,
} from '../services/platformCourtService';

export default function PlatformRegionalAdminsPage() {
  const { isPlatformAdmin } = useTenant();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [territoryId, setTerritoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: catalogs } = useQuery({
    queryKey: ['platform-catalogs'],
    queryFn: fetchJudicialCatalogs,
  });

  const { data: rows, isPending } = useQuery({
    queryKey: ['platform-regional-admins'],
    queryFn: fetchRegionalAdmins,
  });

  if (!isPlatformAdmin) {
    return <Navigate to="/plataforma" replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await grantRegionalAdmin({ email: email.trim(), territoryId, notes: notes.trim() || undefined });
      setEmail('');
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: ['platform-regional-admins'] });
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (userId: string, tid: string) => {
    if (!window.confirm('¿Revocar acceso regional a este territorio?')) return;
    try {
      await revokeRegionalAdmin({ userId, territoryId: tid });
      void queryClient.invalidateQueries({ queryKey: ['platform-regional-admins'] });
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/plataforma"
          className="text-sm font-bold text-indigo-600 hover:underline inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a despachos
        </Link>
        <div className="flex items-center gap-2 text-indigo-600 mb-2">
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Consola plataforma</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Administradores regionales</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl">
          Delegue operación de la consola a funcionarios limitados por territorio judicial. No acceden a
          despachos fuera de su alcance.
        </p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 max-w-xl">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Asignar operador regional</h2>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Correo (usuario Auth existente)</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="funcionario@ramajudicial.gov.co"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Territorio</label>
          <select
            required
            value={territoryId}
            onChange={(e) => setTerritoryId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Seleccione…</option>
            {(catalogs?.territories ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.department})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Asignar'}
        </button>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-bold text-slate-900">Asignaciones activas</h2>
        </div>
        {isPending ? (
          <p className="p-5 text-sm text-slate-500">Cargando…</p>
        ) : !rows?.length ? (
          <p className="p-5 text-sm text-slate-500">Sin operadores regionales asignados.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={`${r.user_id}-${r.territory_id}`} className="flex items-center gap-3 px-5 py-3">
                <MapPin className="w-4 h-4 text-indigo-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {r.profiles?.name ?? r.user_id}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {r.profiles?.email ?? '—'} · {r.judicial_territories?.name ?? r.territory_id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void revoke(r.user_id, r.territory_id)}
                  className="p-2 rounded-lg text-red-600 hover:bg-red-50"
                  title="Revocar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
