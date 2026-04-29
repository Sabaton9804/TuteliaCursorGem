import React, { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DESPACHO_STAFF } from '../lib/court-staff-assignees';
import { rowToUserProfile } from '../lib/supabase-mappers';
import { userRoleLabelEs } from '../lib/user-roles';
import type { UserProfile, UserRole } from '../types';

const DEFAULT_COURT_ID = 'court-1';

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

function mergeDirectoryAndProfiles(
  authUserId: string | null,
  dbMembers: UserProfile[]
): TeamDisplayRow[] {
  const byEmail = new Map(dbMembers.map((m) => [m.email.trim().toLowerCase(), m]));

  const fromCatalog: TeamDisplayRow[] = DESPACHO_STAFF.map((s) => {
    const email = (s.emails?.[0] ?? '').trim();
    const emKey = email.toLowerCase();
    const prof = emKey ? byEmail.get(emKey) : undefined;
    const role = s.courtRole ?? 'official';
    return {
      key: prof?.id ?? `cat-${s.id}`,
      name: s.name,
      email,
      cargoLabel: userRoleLabelEs(role),
      isSelf: Boolean(prof && authUserId && prof.id === authUserId),
      sortRole: role,
    };
  });

  const catalogEmails = new Set(
    DESPACHO_STAFF.flatMap((s) => (s.emails?.[0] ? [s.emails[0].trim().toLowerCase()] : []))
  );

  const extras: TeamDisplayRow[] = [];
  for (const m of dbMembers) {
    const em = m.email.trim().toLowerCase();
    if (!em || catalogEmails.has(em)) continue;
    extras.push({
      key: m.id,
      name: m.name.trim() || m.email,
      email: m.email,
      cargoLabel: userRoleLabelEs(m.role),
      isSelf: authUserId !== null && m.id === authUserId,
      sortRole: m.role,
    });
  }

  return [...fromCatalog, ...extras].sort((a, b) => {
    const ra = hierarchyRank(a.sortRole);
    const rb = hierarchyRank(b.sortRole);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  });
}

export default function Team() {
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [courtName, setCourtName] = useState<string | null>(null);
  const [dbMembers, setDbMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => mergeDirectoryAndProfiles(authUserId, dbMembers),
    [authUserId, dbMembers]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;
      if (cancelled) return;
      setAuthUserId(uid);

      let courtId = DEFAULT_COURT_ID;
      let members: UserProfile[] = [];

      if (uid) {
        const { data: meRow, error: meErr } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
        if (cancelled) return;
        if (!meErr && meRow) {
          courtId = rowToUserProfile(meRow as Record<string, unknown>).courtId;
        }
        if (meErr) {
          setError(
            'No se pudo leer su perfil; se muestra el organigrama del despacho. Si falta marcar «usted», revise la sesión en Supabase.'
          );
        }

        const { data: rpcRows, error: rpcErr } = await supabase.rpc('court_team_members');
        if (!rpcErr && Array.isArray(rpcRows)) {
          members = (rpcRows as Record<string, unknown>[]).map((r) => rowToUserProfile(r));
        } else {
          const fb = await supabase
            .from('profiles')
            .select('*')
            .eq('court_id', courtId)
            .order('name', { ascending: true });
          if (fb.error) {
            console.warn('[Equipo] Lista desde Supabase limitada por RLS o error:', fb.error);
          } else {
            members = ((fb.data as Record<string, unknown>[]) ?? []).map((r) => rowToUserProfile(r));
          }
          if (rpcErr) {
            console.warn('[Equipo] RPC court_team_members:', rpcErr);
          }
        }
      }

      const { data: courtRow } = await supabase.from('courts').select('name').eq('id', courtId).maybeSingle();
      if (cancelled) return;

      setCourtName(typeof courtRow?.name === 'string' && courtRow.name ? courtRow.name : courtId);
      setDbMembers(members);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
            <Users className="w-4 h-4 text-accent" aria-hidden />
            Organización
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Equipo de trabajo</h1>
          <p className="text-sm font-medium text-slate-500 mt-1 max-w-2xl">
            Funcionarios del despacho y cargo. La tabla incluye el organigrama definido para este juzgado; si su usuario coincide en
            Supabase con un correo del equipo, verá <span className="text-slate-700">(usted)</span>.
            {courtName ? (
              <>
                {' '}
                <span className="text-slate-700">{courtName}</span>
              </>
            ) : null}
          </p>
        </div>
        {!loading && rows.length > 0 ? (
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 shrink-0">
            {rows.length} {rows.length === 1 ? 'persona' : 'personas'}
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="card-modern p-12 text-center text-sm font-medium text-slate-500 animate-pulse">Cargando equipo…</div>
      ) : rows.length === 0 ? (
        <div className="card-modern p-12 text-center text-sm text-slate-500">No hay datos de equipo para mostrar.</div>
      ) : (
        <div className="card-modern overflow-hidden border border-slate-100">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Nombre</th>
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Correo</th>
                  <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Cargo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr
                    key={m.key}
                    className={`border-b border-slate-50 last:border-0 ${m.isSelf ? 'bg-accent/5' : 'hover:bg-slate-50/60'}`}
                  >
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {m.name.trim() || '—'}
                      {m.isSelf ? (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-accent">(usted)</span>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-mono text-xs">{m.email || '—'}</td>
                    <td className="px-6 py-4 text-slate-800">{m.cargoLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
