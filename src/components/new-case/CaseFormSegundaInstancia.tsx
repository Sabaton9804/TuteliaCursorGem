import React from 'react';
import type { CaseAppellant, CaseOriginRuling } from '../../types';
import { CaseFormOriginCommon } from './CaseFormOriginCommon';

type Props = {
  originCourt: string;
  setOriginCourt: (v: string) => void;
  originRadicado: string;
  setOriginRadicado: (v: string) => void;
  appellantSel: '' | CaseAppellant;
  setAppellantSel: (v: '' | CaseAppellant) => void;
  originRulingSel: '' | CaseOriginRuling;
  setOriginRulingSel: (v: '' | CaseOriginRuling) => void;
};

export function CaseFormSegundaInstancia({
  originCourt,
  setOriginCourt,
  originRadicado,
  setOriginRadicado,
  appellantSel,
  setAppellantSel,
  originRulingSel,
  setOriginRulingSel,
}: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        Datos del proceso de origen (obligatorios)
      </p>
      <CaseFormOriginCommon
        courtFieldLabel="Juzgado de origen"
        originCourt={originCourt}
        setOriginCourt={setOriginCourt}
        originRadicado={originRadicado}
        setOriginRadicado={setOriginRadicado}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Impugnante</label>
          <select
            value={appellantSel}
            onChange={(e) => setAppellantSel((e.target.value || '') as '' | CaseAppellant)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Seleccione…</option>
            <option value="accionante">Accionante</option>
            <option value="accionado">Accionado</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fallo en origen</label>
          <select
            value={originRulingSel}
            onChange={(e) => setOriginRulingSel((e.target.value || '') as '' | CaseOriginRuling)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Seleccione…</option>
            <option value="concedio">Concedió</option>
            <option value="nego">Negó</option>
          </select>
        </div>
      </div>
    </div>
  );
}
