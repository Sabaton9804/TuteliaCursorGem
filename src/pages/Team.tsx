import React, { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { rowToUserProfile } from '../lib/supabase-mappers';
import { fetchCourtTeamProfiles } from '../lib/court-staff-service';
import { userRoleLabelEs } from '../lib/user-roles';
import type { UserProfile, UserRole } from '../types';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import { useCourtOperational } from '../contexts/CourtOperationalContext';

/** Orden de filas: juez → secretario(a) → sustanciador(a) → escribiente → asistente; otros al final. */
function hierarchyRank(role: UserRole): number {
  const order: Record<UserRole, number> = {
    judge: 0,
    clerk: 1,
    sustanciador: 2,
    escribiente: 3,
    asistente_judicial: 4,
    official: 90,
    admin: 91,
  };
  return order[role] ?? 100;
}

interface TeamDisplayRow {
  key: string;
  name: string;
  email: string;
  cargoLabel: string;
  isSelf: boolean;
  sortRole: UserRole;
}

function profilesToRows(authUserId: string | null, dbMembers: UserProfile[]): TeamDisplayRow[] {
  return dbMembers
    .map((m) => ({
      key: m.id,
      name: m.name.trim() || m.email,
      email: m.email,
      cargoLabel: userRoleLabelEs(m.role),
      isSelf: authUserId !== null && m.id === authUserId,
      sortRole: m.role,
    }))
    .sort((a, b) => {
      const ra = hierarchyRank(a.sortRole);
      const rb = hierarchyRank(b.sortRole);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
}

export default function Team() {
  const { courtId: sessionCourtId } = useSessionCourt();
  const { staff, loading: opsLoading, radicacion } = useCourtOperational();
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [courtName, setCourtName] = useState<string | null>(null);
  const [dbMembers, setDbMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => profilesToRows(authUserId, dbMembers), [authUserId, dbMembers]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;
      if (cancelled) return;
      setAuthUserId(uid);

      let courtId = sessionCourtId;
      let members: UserProfile[] = [];

      if (uid) {
        const { data: meRow, error: meErr } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
        if (cancelled) return;
        if (!meErr && meRow) {
          courtId = rowToUserProfile(meRow as Record<string, unknown>).courtId.trim() || sessionCourtId;
        }
        if (meErr) {
          setError(
            'No se pudo leer su perfil; se muestra el organigrama del despacho. Si falta marcar «usted», revise la sesión en Supabase.'
          );
        }

        members = await fetchCourtTeamProfiles(courtId);
      }

      const { data: courtRow } = await supabase.from('courts').select('name').eq('id', courtId).maybeSingle();
      if (cancelled) return;

      setCourtName(typeof courtRow?.name === 'string' && courtRow.name ? courtRow.name : radicacion.displayName || courtId);
      setDbMembers(members);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionCourtId, radicacion.displayName]);

  const displayCount = rows.length || staff.length;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
            <Users className="w-4 h-4 text-accent" aria-hidden />
            Equipo de trabajo
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{courtName ?? 'Despacho'}</h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            {displayCount} funcionario{displayCount === 1 ? '' : 's'} en este juzgado (datos desde Supabase, por{' '}
            <span className="font-mono text-xs">court_id</span>).
          </p>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">{error}</p>
      ) : null}

      {loading || opsLoading ? (
        <p className="text-sm text-slate-400">Cargando equipo…</p>
      ) : rows.length === 0 ? (
        <div className="card-modern p-8 text-sm text-slate-600 space-y-2">
          <p>No hay perfiles registrados para este despacho en Supabase.</p>
          <p className="text-xs text-slate-400">
            Ejecute <span className="font-mono">npm run seed:court-users</span> o cree filas en{' '}
            <span className="font-mono">public.profiles</span> con el <span className="font-mono">court_id</span>{' '}
            correcto.
          </p>
        </div>
      ) : (
        <div className="card-modern overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <th className="px-6 py-4">Nombre</th>
                <th className="px-6 py-4">Correo</th>
                <th className="px-6 py-4">Cargo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={`border-b border-slate-50 last:border-0 ${r.isSelf ? 'bg-accent/5' : ''}`}
                >
                  <td className="px-6 py-4 font-semibold text-slate-900">
                    {r.name}
                    {r.isSelf ? (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-accent">Usted</span>
                    ) : null}
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-mono text-xs">{r.email || '—'}</td>
                  <td className="px-6 py-4 text-slate-700">{r.cargoLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
