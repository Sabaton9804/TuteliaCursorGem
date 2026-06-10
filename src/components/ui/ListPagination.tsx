import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  LIST_PAGE_SIZE_DEFAULT,
  LIST_PAGE_SIZE_OPTIONS,
  clampPage,
  pageRangeLabel,
  totalPages,
  type ListPageSizeOption,
} from '../../lib/list-pagination';

export type ListPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: ListPageSizeOption) => void;
  className?: string;
};

export default function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className = '',
}: ListPaginationProps) {
  const pages = totalPages(total, pageSize);
  const current = clampPage(page, pages);
  const canPrev = current > 1;
  const canNext = current < pages;

  if (total === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 ${className}`}
    >
      <p className="text-[11px] font-medium tabular-nums text-slate-600">
        {pageRangeLabel(current, pageSize, total)}
        {pages > 1 ? (
          <span className="text-slate-400">
            {' '}
            · página {current} de {pages}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Por página
            <select
              className="input-modern py-1 text-[11px] font-medium normal-case"
              value={pageSize}
              onChange={(e) => {
                const n = Number(e.target.value) as ListPageSizeOption;
                if (LIST_PAGE_SIZE_OPTIONS.includes(n)) onPageSizeChange(n);
              }}
              aria-label="Filas por página"
            >
              {LIST_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => onPageChange(current - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Anterior
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => onPageChange(current + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          aria-label="Página siguiente"
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export { LIST_PAGE_SIZE_DEFAULT };
