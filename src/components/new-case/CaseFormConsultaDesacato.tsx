import React from 'react';
import { CaseFormOriginCommon } from './CaseFormOriginCommon';

type Props = {
  originCourt: string;
  setOriginCourt: (v: string) => void;
  originRadicado: string;
  setOriginRadicado: (v: string) => void;
  conductDescription: string;
  setConductDescription: (v: string) => void;
};

export function CaseFormConsultaDesacato({
  originCourt,
  setOriginCourt,
  originRadicado,
  setOriginRadicado,
  conductDescription,
  setConductDescription,
}: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Remisión (obligatorio)</p>
      <CaseFormOriginCommon
        courtFieldLabel="Juzgado remitente"
        originCourt={originCourt}
        setOriginCourt={setOriginCourt}
        originRadicado={originRadicado}
        setOriginRadicado={setOriginRadicado}
      />
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          ¿Qué decisión o acto se consulta?
        </label>
        <textarea
          value={conductDescription}
          onChange={(e) => setConductDescription(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y min-h-[100px]"
          placeholder="Describa de forma breve la decisión judicial o la conducta sobre la que recae la consulta de desacato."
        />
      </div>
    </div>
  );
}
