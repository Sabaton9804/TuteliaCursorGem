import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatRadicado } from '../lib/formatters';
import { buildExpedienteViewRow, type ExpedienteViewRow } from '../lib/expedientes-view-model';
import { courtCasesQueryKey, fetchCourtCasesForList, type CourtCasesOrderColumn } from '../lib/court-cases-query';
import { useInvalidateCourtCasesOnRealtime } from '../hooks/useCourtCasesRealtime';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import { supabase } from '../lib/supabase';
import { parseSustanciadorAssignmentMode } from '../lib/sustanciador-reparto';

const DASHBOARD_ORDER: CourtCasesOrderColumn = 'updated_at';

function statusLabelEs(status: string): string {
  const m: Record<string, string> = {
    received: 'Recibido',
    admitted: 'Admitido',
    transfer: 'Traslado',
    judgment: 'Fallo',
    archived: 'Archivado',
  };
  return m[status] || status;
}

function semaforoFromRow(row: ExpedienteViewRow) {
  const c = row.case;
  if (row.stage === 'archivado' || c.status === 'archived') {
    return { color: 'bg-gray-200', icon: CheckCircle2, text: 'CERRADO' as const };
  }
  if (row.businessDaysRemaining <= 0) {
    return { color: 'bg-red-500 text-white', icon: AlertTriangle, text: 'VENCIDO' as const };
  }
  if (row.urgency === 'urgent') {
    return { color: 'bg-orange-500 text-white', icon: Clock, text: 'URGENTE' as const };
  }
  return { color: 'bg-green-500 text-white', icon: CheckCircle2, text: 'EN TÉRMINO' as const };
}

export default function Dashboard() {
  const { courtId, profile } = useSessionCourt();
  const allCourts = Boolean(profile?.isSuperuser);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const navigate = useNavigate();

  const { data: cases = [], isPending, error } = useQuery({
    queryKey: [...courtCasesQueryKey(courtId, DASHBOARD_ORDER), allCourts ? 'all-courts' : 'one-court'],
    queryFn: () => fetchCourtCasesForList(courtId, DASHBOARD_ORDER, { allCourts }),
  });

  const { data: courtAssignmentMode } = useQuery({
    queryKey: ['court-sustanciador-mode', courtId],
    queryFn: async () => {
      const { data, error: courtModeErr } = await supabase
        .from('courts')
        .select('sustanciador_assignment_mode')
        .eq('id', courtId)
        .maybeSingle();
      if (courtModeErr) throw courtModeErr;
      return parseSustanciadorAssignmentMode(data?.sustanciador_assignment_mode);
    },
    enabled: Boolean(courtId),
  });

  useInvalidateCourtCasesOnRealtime(courtId, 'dashboard');

  useEffect(() => {
    if (error) console.error('Supabase Error in Dashboard:', error);
  }, [error]);

  const expedienteRows = useMemo(
    () => cases.map((c) => buildExpedienteViewRow(c, courtAssignmentMode ?? null)),
    [cases, courtAssignmentMode],
  );

  const metrics = useMemo(() => {
    const active = cases.filter((c) => c.status !== 'archived').length;
    const critical = expedienteRows.filter(
      (r) =>
        r.urgency === 'urgent' &&
        r.stage !== 'archivado' &&
        r.stage !== 'fallo_notificado'
    ).length;
    const pendingSignature = expedienteRows.filter((r) => r.stage === 'fallo_redactado').length;
    const sgdeLinked = cases.filter((c) => Boolean(c.sgdeId?.trim())).length;
    return { active, critical, pendingSignature, sgdeLinked };
  }, [cases, expedienteRows]);

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return expedienteRows.filter((r) => {
      const c = r.case;
      const matchesSearch =
        c.radicado.toLowerCase().includes(term) || c.claimant.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [expedienteRows, searchTerm, statusFilter]);

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Link
          to="/cases"
          className="card-modern p-6 border-b-4 border-b-accent block hover:bg-slate-50/50 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 rounded-xl"
        >
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Expedientes activos</div>
          <div className="text-3xl font-bold text-slate-900 tracking-tight tabular-nums">{metrics.active}</div>
          <div className="text-[10px] font-bold text-accent mt-2 uppercase tracking-wider">Abrir módulo expedientes →</div>
        </Link>
        <Link
          to="/cases"
          className="card-modern p-6 border-b-4 border-b-red-500 block hover:bg-slate-50/50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-200 rounded-xl"
        >
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Términos críticos</div>
          <div className="text-3xl font-bold text-red-600 tracking-tight tabular-nums">{metrics.critical}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">≤2d háb. o vencido (no archivado)</div>
        </Link>
        <div className="card-modern p-6 border-b-4 border-b-amber-400">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pendiente firma</div>
          <div className="text-3xl font-bold text-slate-900 tracking-tight tabular-nums">{metrics.pendingSignature}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">En etapa fallo redactado</div>
        </div>
        <div className="card-modern p-6 border-b-4 border-b-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Sincronización SGDE</div>
          <div className="text-3xl font-bold text-green-600 tracking-tight tabular-nums">{metrics.sgdeLinked}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">Expedientes con ID SGDE</div>
        </div>
      </div>

      <div className="card-modern overflow-hidden">
        <div className="p-6 border-b border-slate-50 bg-slate-50/30 flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 relative w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por radicado, accionante o demandado..."
              className="input-modern pl-11 bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <select
              className="input-modern py-2 min-w-[200px]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Filtrar por estado: Todos</option>
              <option value="received">Recibidos</option>
              <option value="admitted">Admitidos</option>
              <option value="transfer">Traslado</option>
              <option value="judgment">Fallo</option>
              <option value="archived">Archivado</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-100">
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Identificación Radicado
                </th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Partes intervinientes
                </th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Estado procesal
                </th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Término (10d háb.)
                </th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-slate-400 uppercase tracking-widest">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isPending ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-sm text-slate-400 animate-pulse font-medium">
                    Consultando expedientes…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-sm text-slate-400 font-medium">
                    No hay registros coincidentes para la búsqueda.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const c = row.case;
                  const sem = semaforoFromRow(row);
                  const assignee = row.assignee;
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      onClick={() => navigate(`/case/${c.id}`)}
                    >
                      <td className="px-6 py-5">
                        <div className="text-sm font-bold text-accent tracking-tight group-hover:underline">
                          {formatRadicado(c.radicado)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium mt-0.5">Orden de tutela</div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-700">{c.claimant}</span>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[9px] font-bold text-slate-300 uppercase">vs</span>
                            <span className="text-[11px] font-medium text-slate-500 truncate max-w-[200px]">
                              {c.defendant || '—'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                            c.status === 'received'
                              ? 'bg-blue-50 text-blue-600 border border-blue-100'
                              : c.status === 'admitted'
                                ? 'bg-amber-50 text-amber-600 border border-amber-100'
                                : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}
                        >
                          {statusLabelEs(c.status)}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div
                          className={`flex flex-col gap-0.5 text-xs font-bold ${
                            sem.text === 'VENCIDO' ? 'text-red-500' : sem.text === 'URGENTE' ? 'text-orange-600' : 'text-emerald-600'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                sem.text === 'VENCIDO'
                                  ? 'bg-red-500'
                                  : sem.text === 'URGENTE'
                                    ? 'bg-orange-500'
                                    : 'bg-emerald-500 shadow-sm'
                              }`}
                            />
                            {format(row.deadlineDate, 'd MMM yyyy', { locale: es })}
                          </div>
                          <span className="text-[10px] font-semibold text-slate-500 normal-case pl-4">
                            {row.stage === 'archivado' || c.status === 'archived'
                              ? '—'
                              : row.businessDaysRemaining <= 0
                                ? 'Vencido (10d háb.)'
                                : `${row.businessDaysRemaining} días hábiles restantes`}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600 shrink-0">
                            {assignee.initials}
                          </div>
                          <span className="text-xs font-semibold text-slate-600 truncate" title={assignee.name}>
                            {assignee.name}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="flex justify-between items-center text-[11px] text-slate-400 font-bold uppercase tracking-widest px-2">
        <div>
          Filtro: {filteredRows.length} de {cases.length} expedientes
        </div>
        <div>Última actualización: {format(new Date(), 'hh:mm a', { locale: es })}</div>
      </footer>
    </div>
  );
}
