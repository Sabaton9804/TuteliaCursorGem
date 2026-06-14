import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play } from 'lucide-react';
import {
  fetchPlatformCourtById,
  fetchCourtStaff,
  fetchCourtAuditLog,
  updateCourtStatus,
} from '../../services/platformCourtService';
import { useTenant } from '../../contexts/TenantContext';
import PlatformInviteUserForm from './PlatformInviteUserForm';
import { userRoleLabelEs } from '../../lib/user-roles';
import type { UserRole } from '../../types';

type Tab = 'general' | 'users' | 'audit';

export default function PlatformCourtDetailView() {
  const { courtId = '' } = useParams<{ courtId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setViewAsCourtId } = useTenant();
  const [tab, setTab] = useState<Tab>('general');

  const { data: court, isPending, error } = useQuery({
    queryKey: ['platform-court', courtId],
    queryFn: () => fetchPlatformCourtById(courtId),
    enabled: Boolean(courtId),
  });

  const { data: staff = [], refetch: refetchStaff } = useQuery({
    queryKey: ['platform-court-staff', courtId],
    queryFn: () => fetchCourtStaff(courtId),
    enabled: Boolean(courtId) && tab === 'users',
  });

  const { data: audit = [] } = useQuery({
    queryKey: ['platform-court-audit', courtId],
    queryFn: () => fetchCourtAuditLog(courtId),
    enabled: Boolean(courtId) && tab === 'audit',
  });

  if (isPending) {
    return <p className="text-sm text-slate-500">Cargando despacho…</p>;
  }

  if (error || !court) {
    return (
      <div className="space-y-4">
        <Link to="/plataforma" className="text-sm font-bold text-indigo-600 hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Volver al listado
        </Link>
        <p className="text-red-600">{(error as Error)?.message || 'Despacho no encontrado'}</p>
      </div>
    );
  }

  const cui = [court.dane_code, court.entity_code, court.specialty_code, court.despacho_number]
    .filter(Boolean)
    .join('');

  const onStatusChange = async (status: 'active' | 'inactive' | 'suspended') => {
    await updateCourtStatus(court.id, status);
    void queryClient.invalidateQueries({ queryKey: ['platform-court', courtId] });
    void queryClient.invalidateQueries({ queryKey: ['platform-courts'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <Link to="/plataforma" className="text-sm font-bold text-indigo-600 hover:underline inline-flex items-center gap-1 mb-3">
            <ArrowLeft className="w-4 h-4" /> Consola plataforma
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">{court.name}</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">{court.id}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void setViewAsCourtId(court.id);
            navigate('/');
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-wider"
        >
          <Play className="w-4 h-4" />
          Operar como este despacho
        </button>
      </div>

      <div className="flex gap-2 border-b border-slate-100">
        {(
          [
            ['general', 'Datos generales'],
            ['users', 'Usuarios'],
            ['audit', 'Auditoría'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="card-modern p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase">Estado</p>
            <select
              className="input-modern mt-1 max-w-xs"
              value={court.status}
              onChange={(e) => void onStatusChange(e.target.value as 'active' | 'inactive' | 'suspended')}
            >
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
              <option value="suspended">Suspendido</option>
            </select>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase">Ciudad</p>
            <p className="mt-1 text-slate-800">{court.city || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase">Territorio</p>
            <p className="mt-1 text-slate-800">
              {court.judicial_territories?.name ?? '—'}
              {court.judicial_territories?.department ? ` (${court.judicial_territories.department})` : ''}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase">Especialidad</p>
            <p className="mt-1 text-slate-800">{court.judicial_specialties?.label ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase">Categoría</p>
            <p className="mt-1 text-slate-800">{court.judicial_entity_categories?.label ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase">CUI despacho</p>
            <p className="mt-1 font-mono text-slate-800">{cui || '—'}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase">Correo</p>
            <p className="mt-1 text-slate-800">{court.email || '—'}</p>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-8">
          <div className="card-modern p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Equipo del despacho</h3>
            {staff.length === 0 ? (
              <p className="text-sm text-slate-500">Sin membresías registradas.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {staff.map((row) => {
                  const p = row.profiles as { name?: string; email?: string; role?: string } | null;
                  return (
                    <li key={row.id as string} className="py-3 flex justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-900">{p?.name ?? '—'}</p>
                        <p className="text-xs text-slate-500">{p?.email}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="font-bold text-slate-700">{userRoleLabelEs((row.role as UserRole) || 'clerk')}</p>
                        {row.is_default && <p className="text-indigo-600">Default</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="card-modern p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Invitar usuario</h3>
            <PlatformInviteUserForm courtId={court.id} onInvited={() => void refetchStaff()} />
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card-modern p-6">
          {audit.length === 0 ? (
            <p className="text-sm text-slate-500">Sin eventos de auditoría para este despacho.</p>
          ) : (
            <ul className="space-y-3">
              {audit.map((ev) => (
                <li key={ev.id as string} className="text-sm border-b border-slate-50 pb-2">
                  <span className="font-mono text-xs text-indigo-700">{String(ev.action)}</span>
                  <span className="text-slate-400 mx-2">·</span>
                  <span className="text-xs text-slate-500">{new Date(String(ev.created_at)).toLocaleString('es-CO')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
