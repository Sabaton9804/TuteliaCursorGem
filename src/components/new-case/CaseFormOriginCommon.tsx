import React from 'react';

type Props = {
  courtFieldLabel: string;
  originCourt: string;
  setOriginCourt: (v: string) => void;
  originRadicado: string;
  setOriginRadicado: (v: string) => void;
};

/** Campos compartidos: juzgado y radicado de origen/remisión. */
export function CaseFormOriginCommon({
  courtFieldLabel,
  originCourt,
  setOriginCourt,
  originRadicado,
  setOriginRadicado,
}: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{courtFieldLabel}</label>
        <input
          type="text"
          value={originCourt}
          onChange={(e) => setOriginCourt(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          placeholder="Ej. Juzgado 01 Civil Municipal de Medellín"
          autoComplete="organization"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Radicado de origen</label>
        <input
          type="text"
          value={originRadicado}
          onChange={(e) => setOriginRadicado(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-mono font-semibold text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          placeholder="23 dígitos o referencia completa"
          autoComplete="off"
        />
      </div>
    </div>
  );
}
