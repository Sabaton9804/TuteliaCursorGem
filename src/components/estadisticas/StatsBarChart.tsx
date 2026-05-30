import React from 'react';
import type { StatsChartRow } from '../../lib/tutela-stats-dashboard';

type StatsBarChartProps = {
  rows: StatsChartRow[];
  maxValue?: number;
  emptyLabel?: string;
  horizontal?: boolean;
};

export function StatsBarChart({
  rows,
  maxValue,
  emptyLabel = 'Sin datos en el periodo.',
  horizontal = true,
}: StatsBarChartProps) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-slate-500">{emptyLabel}</p>;
  }

  const max = maxValue ?? Math.max(1, ...rows.map((r) => r.value));

  if (!horizontal) {
    return (
      <div className="flex h-48 items-end justify-center gap-2 px-2">
        {rows.map((row) => {
          const pct = (row.value / max) * 100;
          return (
            <div key={row.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-[10px] font-bold tabular-nums text-slate-600">{row.value}</span>
              <div className="flex w-full max-w-[48px] flex-1 items-end justify-center">
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max(pct, row.value > 0 ? 8 : 0)}%`,
                    backgroundColor: row.color ?? '#0d9488',
                  }}
                  title={`${row.label}: ${row.value}`}
                />
              </div>
              <span className="max-w-full truncate text-center text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                {row.label}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const pct = (row.value / max) * 100;
        return (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-medium text-slate-700">{row.label}</span>
              <span className="shrink-0 tabular-nums font-bold text-slate-900">{row.value}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(pct, row.value > 0 ? 4 : 0)}%`,
                  backgroundColor: row.color ?? '#0d9488',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
