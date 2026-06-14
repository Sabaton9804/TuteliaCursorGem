import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, ChevronLeft, ChevronRight, Plus, Upload } from 'lucide-react';
import {
  fetchPlatformCourtKpis,
  fetchPlatformCourtsPage,
  fetchJudicialCatalogs,
  LIST_PAGE_SIZE_DEFAULT,
  type PlatformCourtFilters,
} from '../../services/platformCourtService';
import {
  LIST_PAGE_SIZE_OPTIONS,
  pageRangeLabel,
  totalPages,
  clampPage,
} from '../../lib/list-pagination';
import PlatformCourtFiltersBar from './PlatformCourtFilters';
import PlatformCreateCourtModal from './PlatformCreateCourtModal';
import PlatformBulkImportModal from './PlatformBulkImportModal';
import { useTenant } from '../../contexts/TenantContext';

export default function PlatformCourtList() {
  const queryClient = useQueryClient();
  const { setViewAsCourtId, isPlatformAdmin, isRegionalPlatformAdmin, regionalTerritoryIds } =
    useTenant();
  const scopeTerritories =
    isRegionalPlatformAdmin && !isPlatformAdmin ? regionalTerritoryIds : undefined;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIST_PAGE_SIZE_DEFAULT);
  const [filters, setFilters] = useState<PlatformCourtFilters>({ status: 'all' });
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const { data: catalogs } = useQuery({
    queryKey: ['platform-catalogs'],
    queryFn: fetchJudicialCatalogs,
    staleTime: 300_000,
  });

  const { data: kpis } = useQuery({
    queryKey: ['platform-court-kpis', scopeTerritories?.join(',') ?? 'all'],
    queryFn: () => fetchPlatformCourtKpis(scopeTerritories),
  });

  const { data, isPending, error } = useQuery({
    queryKey: ['platform-courts', page, pageSize, filterKey, scopeTerritories?.join(',') ?? 'all'],
    queryFn: () => fetchPlatformCourtsPage(page, pageSize, filters, scopeTerritories),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = totalPages(total, pageSize);

  const onFiltersChange = (next: PlatformCourtFilters) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 mb-2">
            <Building2 className="w-5 h-5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Consola plataforma</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Despachos judiciales</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-2xl">
            Gestión nacional de juzgados. Listado paginado server-side; use filtros antes de navegar entre
            páginas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-800 text-xs font-bold uppercase tracking-wider hover:bg-indigo-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Importar CSV
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Crear despacho
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-modern p-5 border-l-4 border-l-indigo-500">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total registrados</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{kpis?.total ?? '—'}</p>
        </div>
        <div className="card-modern p-5 border-l-4 border-l-green-500">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Activos</p>
          <p className="text-2xl font-bold tabular-nums mt-1 text-green-700">{kpis?.active ?? '—'}</p>
        </div>
        <div className="card-modern p-5 border-l-4 border-l-slate-400">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">En esta búsqueda</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{total}</p>
        </div>
      </div>

      <div className="card-modern p-5 space-y-4">
        <PlatformCourtFiltersBar filters={filters} catalogs={catalogs ?? null} onChange={onFiltersChange} />

        {error && (
          <p className="text-sm text-red-600">{(error as Error).message}</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="py-3 pr-4">Despacho</th>
                <th className="py-3 pr-4">Territorio</th>
                <th className="py-3 pr-4">Especialidad</th>
                <th className="py-3 pr-4">Estado</th>
                <th className="py-3 pr-4">CUI</th>
                <th className="py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Sin resultados. Ajuste filtros o cree un despacho.
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const cui = [c.dane_code, c.entity_code, c.specialty_code, c.despacho_number]
                    .filter(Boolean)
                    .join('');
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-slate-900">{c.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{c.id}</div>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {c.judicial_territories?.name ?? c.city ?? '—'}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {c.judicial_specialties?.label ?? '—'}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            c.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : c.status === 'suspended'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-600">{cui || '—'}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to={`/plataforma/courts/${encodeURIComponent(c.id)}`}
                            className="text-xs font-bold text-indigo-600 hover:underline"
                          >
                            Detalle
                          </Link>
                          <button
                            type="button"
                            className="text-xs font-bold text-slate-600 hover:underline"
                            onClick={() => void setViewAsCourtId(c.id)}
                          >
                            Operar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <p className="text-xs text-slate-500">{pageRangeLabel(page, pageSize, total)}</p>
          <div className="flex items-center gap-2">
            <select
              className="input-modern py-1.5 text-xs"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {LIST_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / pág.
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => clampPage(p - 1, pages))}
              className="p-2 rounded-lg border border-slate-200 disabled:opacity-40"
              aria-label="Página anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium tabular-nums px-2">
              {page} / {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => clampPage(p + 1, pages))}
              className="p-2 rounded-lg border border-slate-200 disabled:opacity-40"
              aria-label="Página siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {createOpen && (
        <PlatformCreateCourtModal
          catalogs={catalogs ?? null}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['platform-courts'] });
            void queryClient.invalidateQueries({ queryKey: ['platform-court-kpis'] });
          }}
        />
      )}

      {importOpen && (
        <PlatformBulkImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            void queryClient.invalidateQueries({ queryKey: ['platform-courts'] });
            void queryClient.invalidateQueries({ queryKey: ['platform-court-kpis'] });
          }}
        />
      )}
    </div>
  );
}
