import React from 'react';
import { useCourtOperational } from '../../contexts/CourtOperationalContext';

/**
 * Explicación visual de la regla par/impar (sustanciadores del despacho en BD).
 */
export function RepartoParidadPanel() {
  const { sustanciadores } = useCourtOperational();
  const par = sustanciadores[0];
  const impar = sustanciadores[1] ?? sustanciadores[0];
  if (!par) {
    return (
      <p className="rounded-xl border border-amber-100 bg-amber-50/80 p-4 text-xs text-amber-900">
        Registre al menos un sustanciador en <span className="font-mono">public.profiles</span> con rol{' '}
        <span className="font-mono">sustanciador</span> para este despacho.
      </p>
    );
  }

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white p-4 shadow-sm sm:p-5"
      role="region"
      aria-label="Cómo se reparte según el último dígito del radicado"
    >
      <p className="mb-4 text-sm font-semibold text-slate-800">
        Así se asigna al <span className="text-accent">radicar</span> (solo cuenta el último{' '}
        <strong>número</strong> del radicado; letras y guiones no importan):
      </p>
      {sustanciadores.length < 2 ? (
        <p className="mb-3 text-xs text-slate-600">
          Este despacho tiene un sustanciador registrado: todas las asignaciones automáticas van a{' '}
          <strong>{par.name}</strong>.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">
              Par
            </span>
            <span className="text-xs font-medium text-slate-600">Si el último dígito es uno de:</span>
          </div>
          <p className="font-mono text-lg font-bold tracking-wide text-emerald-900">0 · 2 · 4 · 6 · 8</p>
          <div className="flex items-center gap-3 border-t border-emerald-100/80 pt-3">
            <span
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black ${par.bg} ${par.text} ring-2 ${par.ring}`}
            >
              {par.initials}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Se asigna a</p>
              <p className="text-sm font-bold leading-snug text-slate-900">{par.name}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-violet-600 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">
              Impar
            </span>
            <span className="text-xs font-medium text-slate-600">Si el último dígito es uno de:</span>
          </div>
          <p className="font-mono text-lg font-bold tracking-wide text-violet-900">1 · 3 · 5 · 7 · 9</p>
          <div className="flex items-center gap-3 border-t border-violet-100/80 pt-3">
            <span
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black ${impar.bg} ${impar.text} ring-2 ${impar.ring}`}
            >
              {impar.initials}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-900">Se asigna a</p>
              <p className="text-sm font-bold leading-snug text-slate-900">{impar.name}</p>
            </div>
          </div>
        </div>
      </div>
      {sustanciadores.length >= 2 ? (
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          Ejemplo: si el radicado termina en <strong className="text-slate-700">…7</strong>, el último número es{' '}
          <strong>7</strong> (impar) → corresponde a <strong>{impar.name.split(' ')[0]}</strong>. Si termina en{' '}
          <strong>…0</strong> → <strong>par</strong> → <strong>{par.name.split(' ')[0]}</strong>.
        </p>
      ) : null}
    </div>
  );
}
