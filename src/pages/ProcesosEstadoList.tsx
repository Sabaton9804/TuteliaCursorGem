import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ClipboardList, Filter } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';
import { operationalCourtIdForFetch } from '../services/tenantScope';
import PlatformCourtSelectionPrompt from '../components/platform/PlatformCourtSelectionPrompt';
import {
  courtCasesQueryKey,
  fetchCourtCasesForProcesosList,
  casesListSortToOrderColumn,
  COURT_CASES_STALE_MS,
} from '../lib/court-cases-query';
import { formatRadicado } from '../lib/formatters';
import {
  catalogSituacionLabel,
  catalogTipoProcesoVisible,
  type CaseCatalogMetadata,
} from '../lib/case-catalog-metadata';
import { isProcesosCivilListRow } from '../lib/case-process-scope';
import {
  parseProcesosEstadoFilter,
  procesosEstadoFilterParamKey,
  type ProcesosEstadoListFilter,
} from '../lib/procesos-nav';
import type { Case } from '../types';

function terminadoLabel(c: Case): string {
  const sit = catalogSituacionLabel(c.catalogMetadata).toLowerCase();
  if (sit === 'terminado' || c.status === 'archived' || c.status === 'judgment') return 'Sí';
  return 'No';
}

function normalizeRadicadoQuery(q: string): string {
  return q.replace(/\D/g, '');
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

function matchesEstadoFilters(c: Case, filter: ProcesosEstadoListFilter): boolean {
  const meta = c.catalogMetadata;
  if (filter.tipoProceso !== 'all') {
    const tp = meta?.tipo_proceso || c.subject || '';
    if (tp !== filter.tipoProceso) return false;
  }
  if (filter.situacion !== 'all') {
    if ((meta?.situacion_plataforma || '') !== filter.situacion) return false;
  }
  if (filter.terminado !== 'all') {
    const term = terminadoLabel(c);
    if (filter.terminado === 'si' && term !== 'Sí') return false;
    if (filter.terminado === 'no' && term !== 'No') return false;
  }
  if (filter.encargado !== 'all') {
    const enc = meta?.encargado_nombre || c.assignedTo || '';
    if (enc !== filter.encargado) return false;
  }
  if (filter.etapa !== 'all') {
    if ((meta?.etapa || '') !== filter.etapa) return false;
  }
  if (filter.ubicacion !== 'all') {
    const ub = meta?.ubicacion_interna || c.operationalStatus || '';
    if (ub !== filter.ubicacion) return false;
  }
  if (filter.regimen !== 'all') {
    if ((meta?.regimen || '') !== filter.regimen) return false;
  }
  return true;
}

export default function ProcesosEstadoList() {
  const tenant = useTenant();
  const fetchCourtId = operationalCourtIdForFetch(tenant);
  const [searchParams, setSearchParams] = useSearchParams();
  const listFilter = useMemo(
    () => parseProcesosEstadoFilter(searchParams.toString()),
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
  const queryEnabled = Boolean(fetchCourtId) && !tenant.loading;

  const { data: cases = [], isFetching } = useQuery({
    queryKey: [...courtCasesQueryKey(fetchCourtId ?? 'none', orderCol), tenant.viewAsCourtId ?? 'active', 'procesos-estado'],
    queryFn: () => fetchCourtCasesForProcesosList(fetchCourtId, orderCol),
    enabled: queryEnabled,
    staleTime: COURT_CASES_STALE_MS,
  });

  const civilRows = useMemo(() => cases.filter(isProcesosCivilListRow), [cases]);

  const filterOptions = useMemo(
    () => ({
      tipoProceso: collectDistinct(civilRows, (m, c) => m?.tipo_proceso || c.subject),
      situacion: collectDistinct(civilRows, (m) => m?.situacion_plataforma),
      encargado: collectDistinct(civilRows, (m, c) => m?.encargado_nombre || c.assignedTo),
      etapa: collectDistinct(civilRows, (m) => m?.etapa),
      ubicacion: collectDistinct(civilRows, (m, c) => m?.ubicacion_interna || c.operationalStatus),
      regimen: collectDistinct(civilRows, (m) => m?.regimen),
    }),
    [civilRows],
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const qDigits = normalizeRadicadoQuery(searchTerm);
    return civilRows.filter((c) => {
      if (!matchesEstadoFilters(c, listFilter)) return false;
      if (!q) return true;
      const meta = c.catalogMetadata;
      if (qDigits.length > 0 && c.radicado.replace(/\D/g, '').includes(qDigits)) return true;
      if (c.radicado.toLowerCase().includes(q)) return true;
      if (c.claimant.toLowerCase().includes(q)) return true;
      if (c.defendant.toLowerCase().includes(q)) return true;
      if ((meta?.tipo_proceso || '').toLowerCase().includes(q)) return true;
      if ((meta?.etapa || '').toLowerCase().includes(q)) return true;
      if ((meta?.ubicacion_interna || '').toLowerCase().includes(q)) return true;
      if ((meta?.tramite_pendiente || '').toLowerCase().includes(q)) return true;
      if ((meta?.encargado_nombre || c.assignedTo || '').toLowerCase().includes(q)) return true;
      return false;
    });
  }, [civilRows, searchTerm, listFilter]);

  const resumen = useMemo(() => {
    const terminados = civilRows.filter((c) => terminadoLabel(c) === 'Sí').length;
    const activos = civilRows.filter((c) => catalogSituacionLabel(c.catalogMetadata) === 'activo').length;
    return { total: civilRows.length, terminados, activos, filtrados: filtered.length };
  }, [civilRows, filtered.length]);

  const hasActiveFilters = useMemo(() => {
    return (
      Object.entries(listFilter).some(([, v]) => v !== 'all') || Boolean(searchTerm.trim())
    );
  }, [listFilter, searchTerm]);

  const setFilter = (key: keyof ProcesosEstadoListFilter, value: string) => {
    const next = new URLSearchParams(searchParams);
    const param = procesosEstadoFilterParamKey(key);
    if (value === 'all') next.delete(param);
    else next.set(param, value);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSearchParams({}, { replace: true });
  };

  if (tenant.needsViewAsSelection) return <PlatformCourtSelectionPrompt />;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 text-slate-400 mb-2">
          <ClipboardList className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Catálogo operativo</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Estado por proceso civil</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-3xl">
          Solo procesos de rama civil importados desde plataforma. Las tutelas están en el módulo Tutelas.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="card-modern p-5 border-b-4 border-b-accent">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Civiles importados</p>
          <p className="text-2xl font-bold text-slate-900">{resumen.total}</p>
        </div>
        <div className="card-modern p-5 border-b-4 border-b-emerald-500">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Activos</p>
          <p className="text-2xl font-bold text-slate-900">{resumen.activos}</p>
        </div>
        <div className="card-modern p-5 border-b-4 border-b-slate-400">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Terminados</p>
          <p className="text-2xl font-bold text-slate-900">{resumen.terminados}</p>
        </div>
        <div className="card-modern p-5 border-b-4 border-b-blue-500">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">En vista</p>
          <p className="text-2xl font-bold text-slate-900">{resumen.filtrados}</p>
        </div>
      </div>

      <div className="card-modern overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/40 flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar radicado, demandante, demandado, tipo, etapa, ubicación o trámite…"
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
              <option value="all">Tipo proceso: todos</option>
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
              value={listFilter.terminado}
              onChange={(e) => setFilter('terminado', e.target.value)}
            >
              <option value="all">Terminado: todos</option>
              <option value="si">Solo terminados</option>
              <option value="no">Solo en trámite</option>
            </select>
            <select
              className="input-modern text-xs min-w-[140px]"
              value={listFilter.etapa}
              onChange={(e) => setFilter('etapa', e.target.value)}
            >
              <option value="all">Etapa: todas</option>
              {filterOptions.etapa.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <select
              className="input-modern text-xs min-w-[160px]"
              value={listFilter.ubicacion}
              onChange={(e) => setFilter('ubicacion', e.target.value)}
            >
              <option value="all">Ubicación: todas</option>
              {filterOptions.ubicacion.map((v) => (
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
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-accent hover:underline px-2"
              >
                Limpiar filtros
              </button>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3">Radicado</th>
                <th className="px-4 py-3">Tipo proceso</th>
                <th className="px-4 py-3">Demandante</th>
                <th className="px-4 py-3">Demandado</th>
                <th className="px-4 py-3">Situación</th>
                <th className="px-4 py-3">Terminado</th>
                <th className="px-4 py-3">Etapa</th>
                <th className="px-4 py-3">Ubicación interna</th>
                <th className="px-4 py-3">Trámite pendiente</th>
                <th className="px-4 py-3">Encargado</th>
              </tr>
            </thead>
            <tbody>
              {queryEnabled && isFetching ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">Cargando catálogo civil…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">Sin procesos civiles para los filtros actuales.</td></tr>
              ) : (
                filtered.map((c) => {
                  const m = c.catalogMetadata;
                  const tipoProceso = catalogTipoProcesoVisible(m, c.subject);
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <Link to={`/case/${c.id}?from=procesos`} className="font-mono text-xs font-semibold text-accent hover:underline">
                          {formatRadicado(c.radicado)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[180px] whitespace-normal break-words align-top" title={tipoProceso}>{tipoProceso}</td>
                      <td className="px-4 py-3 text-xs max-w-[220px] whitespace-normal break-words align-top" title={c.claimant}>{c.claimant || '—'}</td>
                      <td className="px-4 py-3 text-xs max-w-[220px] whitespace-normal break-words align-top" title={c.defendant}>{c.defendant || '—'}</td>
                      <td className="px-4 py-3 text-xs">{catalogSituacionLabel(m)}</td>
                      <td className="px-4 py-3 text-xs font-semibold">{terminadoLabel(c)}</td>
                      <td className="px-4 py-3 text-xs max-w-[160px] whitespace-normal break-words align-top" title={m?.etapa}>{m?.etapa || '—'}</td>
                      <td className="px-4 py-3 text-xs max-w-[180px] whitespace-normal break-words align-top" title={m?.ubicacion_interna}>{m?.ubicacion_interna || c.operationalStatus || '—'}</td>
                      <td className="px-4 py-3 text-xs max-w-[220px] whitespace-normal break-words align-top" title={m?.tramite_pendiente}>{m?.tramite_pendiente || '—'}</td>
                      <td className="px-4 py-3 text-xs">{m?.encargado_nombre || c.assignedTo || '—'}</td>
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
