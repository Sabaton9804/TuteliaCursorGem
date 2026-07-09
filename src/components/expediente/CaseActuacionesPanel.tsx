import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { History, Loader2, ListFilter } from 'lucide-react';
import type { CaseType } from '../../types';
import type { CaseTimelineEntry } from '../../lib/case-detail-context';
import {
  ACTUACIONES_RAPIDAS,
  actuacionesCatalogCount,
  searchActuacionesCatalog,
} from '../../lib/actuaciones-catalog';

export type CaseActuacionesPanelProps = {
  timeline: CaseTimelineEntry[];
  caseType?: CaseType | null;
  newActionText: string;
  setNewActionText: (v: string) => void;
  manualActSaving: boolean;
  onRegisterManualAction: () => void | Promise<void>;
};

export function CaseActuacionesPanel({
  timeline,
  caseType,
  newActionText,
  setNewActionText,
  manualActSaving,
  onRegisterManualAction,
}: CaseActuacionesPanelProps) {
  const [catalogQuery, setCatalogQuery] = useState('');
  const suggestions = useMemo(
    () => searchActuacionesCatalog(catalogQuery, caseType, 10),
    [catalogQuery, caseType],
  );
  const listId = 'actuaciones-catalog-suggestions';

  return (
    <div id="panel-trazabilidad" className="card-modern flex w-full min-w-0 flex-col p-6 scroll-mt-24 sm:p-8">
      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          <History className="h-4 w-4 text-accent" aria-hidden /> Trazabilidad operativa
        </h3>
        <p className="max-w-xl text-[11px] leading-snug text-slate-500">
          Actuaciones relevantes del despacho (tabla «case_actions»). Catálogo SIJ adaptado ({actuacionesCatalogCount()}{' '}
          entradas tutela/desacato). El registro técnico completo está en «Historial».
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
        <label htmlFor="manual-actuacion" className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Registrar actuación
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          {ACTUACIONES_RAPIDAS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setNewActionText(label)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-600 hover:border-accent/40 hover:text-accent"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative mt-3">
          <ListFilter className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden />
          <input
            id="actuaciones-catalog-search"
            type="search"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder="Buscar en catálogo (ej. admite tutela, desacato…)"
            className="input-modern w-full pl-9 text-sm"
            aria-controls={listId}
            autoComplete="off"
          />
          {suggestions.length > 0 && catalogQuery.trim() ? (
            <ul
              id={listId}
              className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
              role="listbox"
            >
              {suggestions.map((label) => (
                <li key={label} role="option">
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setNewActionText(label);
                      setCatalogQuery('');
                    }}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <textarea
          id="manual-actuacion"
          value={newActionText}
          onChange={(e) => setNewActionText(e.target.value)}
          rows={3}
          placeholder="Ej.: Auto admite tutela; traslado a la EPS; constancia en SGDE…"
          className="input-modern mt-2 w-full resize-y text-sm"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void onRegisterManualAction()}
            disabled={!newActionText.trim() || manualActSaving}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {manualActSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar en trazabilidad
          </button>
          <span className="text-[10px] text-slate-400">Queda en la tabla «case_actions» y en esta lista.</span>
        </div>
      </div>

      <div className="scrollbar-thin max-h-[min(72vh,640px)] space-y-6 overflow-y-auto pr-1 sm:pr-2">
        {timeline.map((row) => {
          const dotClass =
            row.kind === 'document' ? 'bg-sky-500' : row.kind === 'action' ? 'bg-slate-500' : 'bg-emerald-500';
          const atLabel =
            row.at && !Number.isNaN(Date.parse(row.at))
              ? format(new Date(row.at), 'dd MMM yyyy · HH:mm', { locale: es })
              : '';
          return (
            <div key={row.key} className="relative border-l border-slate-200 pb-1 pl-8 last:pb-0">
              <div
                className={`absolute left-[-5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm ${dotClass}`}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{atLabel}</p>
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    row.kind === 'document'
                      ? 'bg-sky-50 text-sky-800'
                      : row.kind === 'action'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-emerald-50 text-emerald-800'
                  }`}
                >
                  {row.kind === 'document' ? 'Pieza' : row.kind === 'action' ? 'Registro' : 'Sistema'}
                </span>
              </div>
              <p className="mt-1.5 text-sm font-bold leading-snug text-slate-800">{row.title}</p>
              {row.subtitle ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{row.subtitle}</p> : null}
              {row.actor ? (
                <div className="mt-2 flex items-center gap-1.5 opacity-70">
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">
                    {row.actor[0]}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{row.actor}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
