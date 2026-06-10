import React, { useMemo } from 'react';
import { Check, Circle, Minus } from 'lucide-react';
import type { CaseType, Document } from '../../types';
import { buildActTimeline } from '../../lib/case-act-types';

type Props = {
  docs: Document[];
  caseType?: CaseType | null;
  compact?: boolean;
};

export function ExpedienteActTimeline({ docs, caseType, compact = false }: Props) {
  const entries = useMemo(() => buildActTimeline(docs, caseType), [docs, caseType]);
  if (entries.length === 0) return null;

  const presentCount = entries.filter((e) => e.present).length;
  const required = entries.filter((e) => !e.optional);
  const requiredPresent = required.filter((e) => e.present).length;

  return (
    <section className="mb-3 shrink-0 rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          Índice por actos
        </p>
        <p className="text-[10px] font-semibold tabular-nums text-slate-500">
          {presentCount}/{entries.length} actos
          {!compact ? ` · ${requiredPresent}/${required.length} obligatorios` : null}
        </p>
      </div>
      <ol className={`mt-2 ${compact ? 'max-h-32 overflow-y-auto pr-1' : ''} space-y-1`}>
        {entries.map((entry) => (
          <li
            key={entry.code}
            className="flex items-start gap-2 rounded-md px-1 py-0.5 text-[11px] leading-snug"
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
            <span className="min-w-0 flex-1">
              <span
                className={
                  entry.present
                    ? 'font-medium text-slate-800'
                    : entry.optional
                      ? 'text-slate-400'
                      : 'font-medium text-slate-600'
                }
              >
                {String(entry.sortBand).padStart(2, '0')} · {entry.labelEs}
              </span>
              {entry.count > 1 ? (
                <span className="ml-1 text-[10px] text-slate-400">×{entry.count}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
