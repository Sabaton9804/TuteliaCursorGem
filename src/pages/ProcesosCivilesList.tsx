import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Scale, Filter } from 'lucide-react';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import { useTenant } from '../contexts/TenantContext';
import { operationalCourtIdForFetch } from '../services/tenantScope';
import PlatformCourtSelectionPrompt from '../components/platform/PlatformCourtSelectionPrompt';
import {
  courtCasesQueryKey,
  fetchCourtCasesForProcesosList,
  casesListSortToOrderColumn,
  COURT_CASES_STALE_MS,
} from '../lib/court-cases-query';
import { useInvalidateCourtCasesOnRealtime } from '../hooks/useCourtCasesRealtime';
import { formatPartesCompact, formatRadicado } from '../lib/formatters';
import {
  catalogSituacionLabel,
  catalogTipoProcesoVisible,
  type CaseCatalogMetadata,
} from '../lib/case-catalog-metadata';
import { isProcesosCivilListRow } from '../lib/case-process-scope';
import { parseProcesosCivilesFilter } from '../lib/procesos-nav';
import { useResizableTableColumns } from '../hooks/useResizableTableColumns';
import { ResizableTh } from '../components/shared/ResizableTh';
import type { Case } from '../types';

const CIVIL_TABLE_COLUMNS = [
  { id: 'radicado', defaultWidth: 200, minWidth: 140, maxWidth: 320 },
  { id: 'tipo', defaultWidth: 180, minWidth: 100, maxWidth: 360 },
  { id: 'demandante', defaultWidth: 200, minWidth: 120, maxWidth: 420 },
  { id: 'demandado', defaultWidth: 200, minWidth: 120, maxWidth: 420 },
  { id: 'situacion', defaultWidth: 110, minWidth: 90, maxWidth: 180 },
  { id: 'etapa', defaultWidth: 140, minWidth: 90, maxWidth: 280 },
  { id: 'ubicacion', defaultWidth: 170, minWidth: 100, maxWidth: 320 },
  { id: 'encargado', defaultWidth: 160, minWidth: 100, maxWidth: 280 },
  { id: 'ultimoAuto', defaultWidth: 150, minWidth: 90, maxWidth: 280 },
] as const;

function normalizeRadicadoQuery(q: string): string {
  return q.replace(/\D/g, '');
}

function situacionChipClass(situacion: string): string {
  const s = situacion.toLowerCase();
  if (s === 'terminado') return 'bg-slate-100 text-slate-600 border-slate-200';
  if (s === 'remitido') return 'bg-violet-50 text-violet-700 border-violet-100';
  if (s === 'activo') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  return 'bg-slate-50 text-slate-500 border-slate-100';
}

function collectDistinct(
  rows: Case[],
  pick: (meta: CaseCatalogMetadata | undefined, c: Case) => string | undefined,
): string[] {
  const set = new Set<string>();
  for (const c of rows) {
    const v = pick(c.catalogMetadata, c)?.trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

export default function ProcesosCivilesList() {
  const { courtId } = useSessionCourt();
  const tenant = useTenant();
  const fetchCourtId = operationalCourtIdForFetch(tenant);
  const [searchParams, setSearchParams] = useSearchParams();
  const listFilter = useMemo(
    () => parseProcesosCivilesFilter(searchParams.toString()),
    [searchParams],
  );
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') || '');

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (searchTerm.trim()) next.set('q', searchTerm.trim());
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [searchTerm, searchParams, setSearchParams]);

  const orderCol = casesListSortToOrderColumn('radicado');

  const { data: cases = [], isPending, error } = useQuery({
    queryKey: [...courtCasesQueryKey(fetchCourtId ?? 'none', orderCol), tenant.viewAsCourtId ?? 'active', 'procesos-civiles'],
    queryFn: () => fetchCourtCasesForProcesosList(fetchCourtId, orderCol),
    enabled: Boolean(fetchCourtId),
    staleTime: COURT_CASES_STALE_MS,
  });

  useInvalidateCourtCasesOnRealtime(courtId, 'list');

  const { beginResize, colStyle } = useResizableTableColumns(
    'tutelia.procesos-civiles.col-widths',
    [...CIVIL_TABLE_COLUMNS],
  );

  const civilRows = useMemo(() => cases.filter(isProcesosCivilListRow), [cases]);

  const filterOptions = useMemo(
    () => ({
      tipoProceso: collectDistinct(civilRows, (m, c) => m?.tipo_proceso || c.subject),
      situacion: collectDistinct(civilRows, (m) => m?.situacion_plataforma),
      encargado: collectDistinct(civilRows, (m, c) => m?.encargado_nombre || c.assignedTo),
      regimen: collectDistinct(civilRows, (m) => m?.regimen),
    }),
    [civilRows],
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const qDigits = normalizeRadicadoQuery(searchTerm);
    return civilRows.filter((c) => {
      const meta = c.catalogMetadata;
      if (listFilter.tipoProceso !== 'all') {
        const tp = meta?.tipo_proceso || c.subject || '';
        if (tp !== listFilter.tipoProceso) return false;
      }
      if (listFilter.situacion !== 'all') {
        if ((meta?.situacion_plataforma || '') !== listFilter.situacion) return false;
      }
      if (listFilter.encargado !== 'all') {
        const enc = meta?.encargado_nombre || c.assignedTo || '';
        if (enc !== listFilter.encargado) return false;
      }
      if (listFilter.regimen !== 'all') {
        if ((meta?.regimen || '') !== listFilter.regimen) return false;
      }
      if (!q) return true;
      if (qDigits.length > 0 && c.radicado.replace(/\D/g, '').includes(qDigits)) return true;
      if (c.radicado.toLowerCase().includes(q)) return true;
      if (c.claimant.toLowerCase().includes(q)) return true;
      if (c.defendant.toLowerCase().includes(q)) return true;
      if ((meta?.tipo_proceso || '').toLowerCase().includes(q)) return true;
      if ((meta?.ubicacion_interna || '').toLowerCase().includes(q)) return true;
      return false;
    });
  }, [civilRows, searchTerm, listFilter]);

  const setFilter = (key: keyof typeof listFilter, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete(key === 'tipoProceso' ? 'tipo' : key);
    else next.set(key === 'tipoProceso' ? 'tipo' : key, value);
    setSearchParams(next, { replace: true });
  };

  if (tenant.needsViewAsSelection) {
    return <PlatformCourtSelectionPrompt />;
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 text-slate-400 mb-2">
          <Scale className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Procesos civiles</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Catálogo civil</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl">
          Procesos de rama civil del despacho. Filtros alineados al catálogo de plataforma: tipo,
          situación, encargado y régimen. El detalle reutiliza el expediente digital (SGDE).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-modern p-5 border-b-4 border-b-accent">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Civiles en despacho</p>
          <p className="text-2xl font-bold text-slate-900">{civilRows.length}</p>
        </div>
        <div className="card-modern p-5 border-b-4 border-b-blue-500">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Tras filtros</p>
          <p className="text-2xl font-bold text-slate-900">{filtered.length}</p>
        </div>
        <div className="card-modern p-5 border-b-4 border-b-emerald-500">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Con SGDE</p>
          <p className="text-2xl font-bold text-slate-900">
            {civilRows.filter((c) => c.sgdeId?.trim()).length}
          </p>
        </div>
      </div>

      <div className="card-modern overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/40 flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar radicado, partes, tipo o ubicación…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-modern w-full pl-11"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
            <select
              className="input-modern text-xs min-w-[160px]"
              value={listFilter.tipoProceso}
              onChange={(e) => setFilter('tipoProceso', e.target.value)}
            >
              <option value="all">Tipo: todos</option>
              {filterOptions.tipoProceso.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <select
              className="input-modern text-xs min-w-[140px]"
              value={listFilter.situacion}
              onChange={(e) => setFilter('situacion', e.target.value)}
            >
              <option value="all">Situación: todas</option>
              {filterOptions.situacion.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <select
              className="input-modern text-xs min-w-[140px]"
              value={listFilter.encargado}
              onChange={(e) => setFilter('encargado', e.target.value)}
            >
              <option value="all">Encargado: todos</option>
              {filterOptions.encargado.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <select
              className="input-modern text-xs min-w-[120px]"
              value={listFilter.regimen}
              onChange={(e) => setFilter('regimen', e.target.value)}
            >
              <option value="all">Régimen: todos</option>
              {filterOptions.regimen.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-fixed text-left text-sm" style={{ width: 'max-content', minWidth: '100%' }}>
            <thead>
              <tr className="border-b border-slate-100 bg-white text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <ResizableTh label="Radicado" style={colStyle('radicado')} onResizeStart={(x) => beginResize('radicado', x)} />
                <ResizableTh label="Tipo proceso" style={colStyle('tipo')} onResizeStart={(x) => beginResize('tipo', x)} />
                <ResizableTh label="Demandante" style={colStyle('demandante')} onResizeStart={(x) => beginResize('demandante', x)} />
                <ResizableTh label="Demandado" style={colStyle('demandado')} onResizeStart={(x) => beginResize('demandado', x)} />
                <ResizableTh label="Situación" style={colStyle('situacion')} onResizeStart={(x) => beginResize('situacion', x)} />
                <ResizableTh label="Etapa" style={colStyle('etapa')} onResizeStart={(x) => beginResize('etapa', x)} />
                <ResizableTh label="Ubicación / trámite" style={colStyle('ubicacion')} onResizeStart={(x) => beginResize('ubicacion', x)} />
                <ResizableTh label="Encargado" style={colStyle('encargado')} onResizeStart={(x) => beginResize('encargado', x)} />
                <ResizableTh label="Último auto" style={colStyle('ultimoAuto')} onResizeStart={(x) => beginResize('ultimoAuto', x)} />
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400 font-mono text-xs">
                    CARGANDO…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-red-600 text-sm">
                    Error al cargar procesos.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">
                    {civilRows.length === 0
                      ? 'No hay procesos civiles. Ejecute el script import-plataforma-catalog.'
                      : 'Sin resultados con los filtros actuales.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const meta = c.catalogMetadata;
                  const situacion = catalogSituacionLabel(meta);
                  const ultimoAuto = meta?.ultimo_auto_tipo
                    ? `${meta.ultimo_auto_tipo}${meta.ultimo_auto_fecha ? ` (${meta.ultimo_auto_fecha})` : ''}`
                    : '—';
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-4 py-3 truncate" style={colStyle('radicado')}>
                        <Link
                          to={`/case/${c.id}?from=procesos`}
                          className="font-mono text-xs font-semibold text-accent hover:underline"
                          title={formatRadicado(c.radicado)}
                        >
                          {formatRadicado(c.radicado)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 truncate" style={colStyle('tipo')} title={catalogTipoProcesoVisible(meta, c.subject)}>
                        {catalogTipoProcesoVisible(meta, c.subject)}
                      </td>
                      <td className="px-4 py-3 truncate text-slate-700" style={colStyle('demandante')} title={c.claimant}>
                        {formatPartesCompact(c.claimant)}
                      </td>
                      <td className="px-4 py-3 truncate text-slate-700" style={colStyle('demandado')} title={c.defendant}>
                        {formatPartesCompact(c.defendant)}
                      </td>
                      <td className="px-4 py-3 truncate" style={colStyle('situacion')}>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${situacionChipClass(situacion)}`}>
                          {situacion}
                        </span>
                      </td>
                      <td className="px-4 py-3 truncate text-slate-600" style={colStyle('etapa')} title={meta?.etapa}>
                        {meta?.etapa || '—'}
                      </td>
                      <td className="px-4 py-3 truncate text-slate-600" style={colStyle('ubicacion')} title={meta?.ubicacion_interna || meta?.tramite_pendiente}>
                        {meta?.ubicacion_interna || c.operationalStatus || '—'}
                      </td>
                      <td className="px-4 py-3 truncate text-slate-600" style={colStyle('encargado')} title={meta?.encargado_nombre || c.assignedTo || undefined}>
                        {meta?.encargado_nombre || c.assignedTo || '—'}
                      </td>
                      <td className="px-4 py-3 truncate text-slate-500 text-xs" style={colStyle('ultimoAuto')} title={ultimoAuto}>
                        {ultimoAuto}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
