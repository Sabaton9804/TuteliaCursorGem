import React from 'react';
import { SUSTANCIADORES } from '../../lib/court-staff-assignees';

export function RepartoAlternadoPanel({ cursor }: { cursor: number }) {
  const idx = Number.isFinite(cursor) ? Math.abs(Math.trunc(cursor)) % 2 : 0;
  const proximo = SUSTANCIADORES[idx] ?? SUSTANCIADORES[0];
  const siguiente = SUSTANCIADORES[idx === 0 ? 1 : 0] ?? SUSTANCIADORES[1];
  if (!proximo || !siguiente) return null;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm sm:p-5"
      role="region"
      aria-label="Turnos uno y uno al radicar"
    >
      <p className="mb-3 text-sm font-semibold text-slate-800">Una y una: cada nueva radicación alterna sustanciador.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <span className="rounded-md bg-accent px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
            Ahora le toca
          </span>
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${proximo.bg} ${proximo.text} ring-1 ${proximo.ring}`}
          >
            {proximo.initials}
          </span>
          <p className="min-w-0 text-sm font-bold text-slate-900">{proximo.name}</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white/80 p-3">
          <span className="rounded-md bg-slate-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
            Después
          </span>
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${siguiente.bg} ${siguiente.text} ring-1 ${siguiente.ring}`}
          >
            {siguiente.initials}
          </span>
          <p className="min-w-0 text-sm font-bold text-slate-700">{siguiente.name}</p>
        </div>
      </div>
    </div>
  );
}
