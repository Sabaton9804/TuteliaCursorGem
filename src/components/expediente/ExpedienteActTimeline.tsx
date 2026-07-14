import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Circle, Minus } from 'lucide-react';
import type { CaseType, Document } from '../../types';
import { buildActTimeline } from '../../lib/case-act-types';

type Props = {
  docs: Document[];
  caseType?: CaseType | null;
  compact?: boolean;
};

/** Checklist colapsable (cerrado por defecto): no debe tapar el árbol del expediente. */
export function ExpedienteActTimeline({ docs, caseType, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => buildActTimeline(docs, caseType), [docs, caseType]);
  if (entries.length === 0) return null;

  const presentCount = entries.filter((e) => e.present).length;
  const required = entries.filter((e) => !e.optional);
  const requiredPresent = required.filter((e) => e.present).length;

  return (
    <div className="mb-2 shrink-0 rounded-lg border border-slate-200/80 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50/80 transition-colors"
        aria-expanded={open}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
          Actos tipificados
        </span>
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-slate-400">
          {presentCount}/{entries.length}
          {!compact ? ` · ${requiredPresent} clave` : null}
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-100 px-2.5 pb-2 pt-1.5">
          <p className="mb-1.5 text-[10px] text-slate-400 leading-snug">
            Catálogo procesal opcional. Los archivos del proceso están en el árbol de abajo.
          </p>
          {docs.length > 0 && presentCount === 0 ? (
            <p className="mb-1.5 rounded-md bg-slate-50 px-2 py-1 text-[10px] text-slate-500 leading-snug">
              Piezas sin tipificar (p. ej. SGDE). Puede abrirlas igual en el árbol.
            </p>
          ) : null}
          <ol className={`space-y-0.5 ${compact ? 'max-h-28 overflow-y-auto pr-1' : 'max-h-40 overflow-y-auto pr-1'}`}>
            {entries.map((entry) => (
              <li
                key={entry.code}
                className="flex items-start gap-2 rounded px-1 py-0.5 text-[11px] leading-snug"
              >
                <span className="mt-0.5 shrink-0">
                  {entry.present ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  ) : entry.optional ? (
                    <Minus className="h-3.5 w-3.5 text-slate-300" aria-hidden />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  )}
                </span>
                <span
                  className={
                    entry.present
                      ? 'font-medium text-slate-800'
                      : entry.optional
                        ? 'text-slate-400'
                        : 'text-slate-600'
                  }
                >
                  {String(entry.sortBand).padStart(2, '0')} · {entry.labelEs}
                  {entry.count > 1 ? (
                    <span className="ml-1 text-[10px] text-slate-400">×{entry.count}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
