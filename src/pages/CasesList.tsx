import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Search, PlusCircle, Gavel, Inbox, ArrowUpDown, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { rowToCase, rowToUserProfile } from '../lib/supabase-mappers';
import type { Case, CaseStatus, UserProfile } from '../types';
import ExpedientesViews, { type ExpedientesViewMode } from '../components/expedientes/ExpedientesViews';
import { buildExpedienteViewRow } from '../lib/expedientes-view-model';
import { assignedToMatchesProfile, SUSTANCIADORES } from '../lib/court-staff-assignees';
import { intentFreshNewCaseFromMenu } from '../lib/new-case-nav';
import { CASE_LIST_COLUMNS } from '../lib/case-list-query';

const COURT_ID = 'court-1';

const STATUS_OPTIONS: { value: CaseStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'received', label: 'Recibido' },
  { value: 'admitted', label: 'Admitido' },
  { value: 'transfer', label: 'Traslado' },
  { value: 'judgment', label: 'Fallo' },
  { value: 'archived', label: 'Archivado' },
];

const SORT_OPTIONS = [
  { value: 'updated', label: 'Última actualización' },
  { value: 'created', label: 'Fecha de creación' },
  { value: 'radicado', label: 'Radicado (número)' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

function normalizeRadicadoQuery(q: string): string {
  return q.replace(/\D/g, '');
}

function parseStatusParam(v: string | null): CaseStatus | 'all' {
  const ok: (CaseStatus | 'all')[] = ['all', 'received', 'admitted', 'transfer', 'judgment', 'archived'];
  return ok.includes(v as CaseStatus | 'all') ? (v as CaseStatus | 'all') : 'all';
}

function parseSortParam(v: string | null): SortKey {
  return v === 'created' || v === 'radicado' ? v : 'updated';
}

function parseViewParam(v: string | null): ExpedientesViewMode {
  if (v === 'lista' || v === 'calendario') return v;
  return 'kanban';
}

const ASSIGNEE_SELECT_OPTIONS = SUSTANCIADORES.map((a) => ({
  id: a.id,
  label: `${a.initials} — ${a.name}`,
}));

export default function CasesList() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>(() => parseStatusParam(searchParams.get('status')));
  const [sortBy, setSortBy] = useState<SortKey>(() => parseSortParam(searchParams.get('sort')));
  const [view, setView] = useState<ExpedientesViewMode>(() => parseViewParam(searchParams.get('vista')));
  const [boardFilterKind, setBoardFilterKind] = useState<'all' | 'due' | 'mine'>('all');
  const [assigneeFilterId, setAssigneeFilterId] = useState<string | 'all'>('all');
  const [derechoFilter, setDerechoFilter] = useState<string | 'all'>('all');
  const [authUserId, setAuthUserId] = useState<string | undefined>();
  const [sessionProfile, setSessionProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthUserId(data.session?.user?.id);
    });
  }, []);

  useEffect(() => {
    if (!authUserId) {
      setSessionProfile(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('*')
      .eq('id', authUserId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setSessionProfile(null);
          return;
        }
        setSessionProfile(rowToUserProfile(data as Record<string, unknown>));
      });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (searchTerm.trim()) next.set('q', searchTerm.trim());
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (sortBy !== 'updated') next.set('sort', sortBy);
    if (view !== 'kanban') next.set('vista', view);
    setSearchParams(next, { replace: true });
  }, [searchTerm, statusFilter, sortBy, view, setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    async function loadCases() {
      setLoading(true);
      const col =
        sortBy === 'created' ? 'created_at' : sortBy === 'radicado' ? 'radicado' : 'updated_at';
      const { data, error } = await supabase
        .from('cases')
        .select(CASE_LIST_COLUMNS)
        .eq('court_id', COURT_ID)
        .order(col, { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('CasesList Supabase:', error);
        setCases([]);
        setLoading(false);
        return;
      }
      setCases((data || []).map((r) => rowToCase(r as unknown as Record<string, unknown>)));
      setLoading(false);
    }

    void loadCases();

    const channel = supabase
      .channel(`cases-list-${COURT_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cases', filter: `court_id=eq.${COURT_ID}` },
        () => void loadCases()
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sortBy]);

  const filteredCases = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const qDigits = normalizeRadicadoQuery(searchTerm);
    return cases.filter((c) => {
      const statusOk = statusFilter === 'all' || c.status === statusFilter;
      if (!statusOk) return false;
      if (!q) return true;
      if (qDigits.length > 0 && c.radicado.replace(/\D/g, '').includes(qDigits)) return true;
      if (c.radicado.toLowerCase().includes(q)) return true;
      if (c.claimant.toLowerCase().includes(q)) return true;
      if (c.defendant.toLowerCase().includes(q)) return true;
      if ((c.subject || '').toLowerCase().includes(q)) return true;
      return false;
    });
  }, [cases, searchTerm, statusFilter]);

  const enrichedBase = useMemo(() => filteredCases.map(buildExpedienteViewRow), [filteredCases]);

  const derechoOptions = useMemo(
    () => Array.from(new Set(enrichedBase.map((e) => e.derechoTag))).sort(),
    [enrichedBase]
  );

  const viewRows = useMemo(() => {
    let r = enrichedBase;
    if (boardFilterKind === 'due') {
      r = r.filter(
        (x) =>
          x.stage !== 'archivado' &&
          x.stage !== 'fallo_notificado' &&
          x.businessDaysRemaining > 0 &&
          x.businessDaysRemaining <= 4
      );
    }
    if (boardFilterKind === 'mine') {
      r = r.filter((x) => assignedToMatchesProfile(x.case.assignedTo, sessionProfile?.name));
    }
    if (assigneeFilterId !== 'all') {
      r = r.filter((x) => x.assignee.id === assigneeFilterId);
    }
    if (derechoFilter !== 'all') {
      r = r.filter((x) => x.derechoTag === derechoFilter);
    }
    return r;
  }, [enrichedBase, boardFilterKind, sessionProfile?.name, assigneeFilterId, derechoFilter]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 text-slate-400 mb-2">
            <Gavel className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Módulo judicial</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Expedientes</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-xl">
            Tablero, lista y calendario con término de <strong className="text-slate-700">10 días hábiles</strong>{' '}
            desde radicación (lun–vie). Sustanciador por defecto (Diego / Myriam) si el expediente no tiene{' '}
            <span className="font-mono text-slate-600">assigned_to</span>; «Mis asignadas» usa ese campo y su perfil.
          </p>
        </div>
        <Link
          to="/new"
          onClick={() => intentFreshNewCaseFromMenu(location.pathname === '/new')}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent text-white text-xs font-bold uppercase tracking-widest shadow-lg shadow-accent/20 hover:opacity-95 transition-opacity shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          Nueva tutela
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-modern p-5 border-b-4 border-b-accent">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total en despacho</p>
          <p className="text-2xl font-bold text-slate-900">{cases.length}</p>
        </div>
        <div className="card-modern p-5 border-b-4 border-b-blue-500">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Tras búsqueda / estado</p>
          <p className="text-2xl font-bold text-slate-900">{filteredCases.length}</p>
        </div>
        <div className="card-modern p-5 border-b-4 border-b-slate-300">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">En vista (filtros tablero)</p>
          <p className="text-2xl font-bold text-slate-900">{viewRows.length}</p>
        </div>
      </div>

      <div className="card-modern overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/40 flex flex-col xl:flex-row gap-4">
          <div className="flex-1 relative min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar por radicado, accionante, demandado o asunto…"
              className="input-modern pl-11 w-full bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Buscar expedientes"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <div className="relative flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400 hidden sm:block" />
              <select
                className="input-modern py-2 min-w-[200px] bg-white"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as CaseStatus | 'all')}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-slate-400 hidden sm:block" />
              <select
                className="input-modern py-2 min-w-[200px] bg-white"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {filteredCases.length === 0 && !loading ? (
        <div className="card-modern p-16 text-center">
          <Inbox className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No hay expedientes que coincidan</p>
          <p className="text-xs text-slate-400 mt-1 mb-4">
            {cases.length === 0
              ? 'Aún no hay radicaciones. Use «Nueva tutela» para el primero.'
              : 'Pruebe otro término de búsqueda o quite filtros.'}
          </p>
          <Link
            to="/new"
            onClick={() => intentFreshNewCaseFromMenu(location.pathname === '/new')}
            className="text-xs font-bold text-accent uppercase tracking-widest hover:underline"
          >
            Ir a nueva tutela
          </Link>
        </div>
      ) : (
        <ExpedientesViews
          rows={viewRows}
          view={view}
          onViewChange={setView}
          filterKind={boardFilterKind}
          onFilterKind={setBoardFilterKind}
          assigneeFilterId={assigneeFilterId}
          onAssigneeFilterId={setAssigneeFilterId}
          derechoFilter={derechoFilter}
          onDerechoFilter={setDerechoFilter}
          assigneeOptions={ASSIGNEE_SELECT_OPTIONS}
          derechoOptions={derechoOptions}
          loading={loading}
        />
      )}

      <p className="text-[11px] text-slate-400 font-medium px-1">
        Los expedientes viven en <span className="font-mono text-slate-500">public.cases</span>. El estado del tablero
        se infiere de <span className="font-mono">status</span> y, si existe,{' '}
        <span className="font-mono">operational_status</span>. El derecho tutelado en vista viene de{' '}
        <span className="font-mono">legal_derecho_tutelado</span>. Asignación:{' '}
        <span className="font-mono">assigned_to</span> (nombre o correo del despacho); si está vacío, reparto entre los
        dos sustanciadores (Diego Guarín / Myriam Fonseca).
      </p>
    </div>
  );
}
