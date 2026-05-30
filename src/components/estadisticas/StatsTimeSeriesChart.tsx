import React from 'react';
import type { StatsTimePoint } from '../../lib/tutela-stats-dashboard';

type StatsTimeSeriesChartProps = {
  points: StatsTimePoint[];
  emptyLabel?: string;
  /** Si false, solo dibuja la serie de ingresos. */
  showSalidas?: boolean;
};

export function StatsTimeSeriesChart({
  points,
  emptyLabel = 'Sin movimientos en el periodo.',
  showSalidas = true,
}: StatsTimeSeriesChartProps) {
  const hasData = points.some((p) => p.ingresos > 0 || (showSalidas && p.salidas > 0));
  if (!hasData) {
    return <p className="py-8 text-center text-sm text-slate-500">{emptyLabel}</p>;
  }

  const max = Math.max(
    1,
    ...points.flatMap((p) => (showSalidas ? [p.ingresos, p.salidas] : [p.ingresos])),
  );
  const w = 640;
  const h = 200;
  const pad = { t: 16, r: 12, b: 36, l: 12 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const step = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const y = (v: number) => pad.t + innerH - (v / max) * innerH;

  const ingresosPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad.l + i * step} ${y(p.ingresos)}`)
    .join(' ');
  const salidasPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${pad.l + i * step} ${y(p.salidas)}`)
    .join(' ');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-xs font-semibold text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-teal-600" aria-hidden />
          Ingresos (radicación)
        </span>
        {showSalidas ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-violet-600" aria-hidden />
            Salidas (decisión)
          </span>
        ) : null}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-h-[220px]" role="img" aria-label="Serie temporal ingresos y salidas">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const yy = pad.t + innerH * (1 - t);
          return (
            <line
              key={t}
              x1={pad.l}
              x2={w - pad.r}
              y1={yy}
              y2={yy}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          );
        })}
        <path d={ingresosPath} fill="none" stroke="#0d9488" strokeWidth={2.5} strokeLinejoin="round" />
        {showSalidas ? (
          <path d={salidasPath} fill="none" stroke="#7c3aed" strokeWidth={2.5} strokeLinejoin="round" />
        ) : null}
        {points.map((p, i) => (
          <g key={p.key}>
            <circle cx={pad.l + i * step} cy={y(p.ingresos)} r={3.5} fill="#0d9488" />
            {showSalidas ? <circle cx={pad.l + i * step} cy={y(p.salidas)} r={3.5} fill="#7c3aed" /> : null}
            <text
              x={pad.l + i * step}
              y={h - 8}
              textAnchor="middle"
              className="fill-slate-500 text-[10px] font-medium"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
