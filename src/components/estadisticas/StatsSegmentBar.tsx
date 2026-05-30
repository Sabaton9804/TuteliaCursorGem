import React from 'react';
import type { StatsChartRow } from '../../lib/tutela-stats-dashboard';

type StatsSegmentBarProps = {
  rows: StatsChartRow[];
  emptyLabel?: string;
};

/** Barra apilada horizontal (estado / etapa operativa). */
export function StatsSegmentBar({ rows, emptyLabel = 'Sin datos.' }: StatsSegmentBarProps) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) {
    return <p className="py-4 text-center text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
        {rows.map((row) => (
          <div
            key={row.key}
            className="h-full transition-all"
            style={{
              width: `${(row.value / total) * 100}%`,
              backgroundColor: row.color ?? '#64748b',
            }}
            title={`${row.label}: ${row.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 text-xs text-slate-600">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color ?? '#64748b' }}
              aria-hidden
            />
            <span className="font-medium">{row.label}</span>
            <span className="tabular-nums font-bold text-slate-800">{row.value}</span>
            <span className="text-slate-400">({Math.round((row.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
