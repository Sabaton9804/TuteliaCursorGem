import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, Clock, CloudDownload } from 'lucide-react';
import type { CaseType } from '../../types';
import { CASE_TYPE_CARD_COPY } from '../../hooks/useNewCaseForm';
import { COMING_SOON_PROCESS_PREVIEWS, MVP_RADICABLE_CASE_TYPES } from '../../lib/process-product-scope';

type Props = {
  error: string | null;
  onSelectCaseType: (t: CaseType) => void;
  onClearError: () => void;
};

function ProcessCardShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-left rounded-2xl border-2 p-8 md:min-h-[220px] shadow-sm flex flex-col gap-3 ${className}`}
    >
      {children}
    </div>
  );
}

export function CaseTypeSelector({ error, onSelectCaseType, onClearError }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      <p className="text-center text-sm font-medium text-slate-600 max-w-2xl mx-auto leading-relaxed">
        Seleccione el tipo de tutela para radicar. Otros procesos judiciales aparecen como referencia; estarán
        disponibles en actualizaciones posteriores.
      </p>

      <section className="space-y-4" aria-labelledby="tutela-types-heading">
        <h2
          id="tutela-types-heading"
          className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1"
        >
          Tutela constitucional — disponible
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MVP_RADICABLE_CASE_TYPES.map((key) => {
            const c = CASE_TYPE_CARD_COPY[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onSelectCaseType(key);
                  onClearError();
                }}
                className="group text-left rounded-2xl border-2 border-slate-200 bg-white p-8 md:min-h-[220px] shadow-sm transition-all hover:border-accent hover:shadow-xl hover:shadow-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 flex flex-col gap-3"
              >
                <span className="text-4xl leading-none" aria-hidden>
                  {c.emoji}
                </span>
                <span className="text-base font-black text-slate-900 tracking-tight">{c.title}</span>
                <span className="text-sm font-semibold text-slate-600 leading-snug">{c.subtitle}</span>
                <span className="mt-auto pt-4 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-accent">
                  Continuar
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="other-processes-heading">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <h2
            id="other-processes-heading"
            className="text-[10px] font-black uppercase tracking-widest text-slate-400"
          >
            Otros procesos
          </h2>
          <span className="text-[10px] font-semibold text-slate-400">— próximamente</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {COMING_SOON_PROCESS_PREVIEWS.map((p) => (
            <ProcessCardShell
              key={p.id}
              className="relative border-dashed border-slate-200 bg-slate-50/80 opacity-90 cursor-not-allowed select-none"
            >
              <span
                className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-slate-200/90 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-600"
                aria-hidden
              >
                <Clock className="h-3 w-3 shrink-0" />
                Próximamente
              </span>
              <span className="text-3xl leading-none opacity-60" aria-hidden>
                {p.emoji}
              </span>
              <span className="text-sm font-black text-slate-500 tracking-tight pr-16">{p.title}</span>
              <span className="text-xs font-medium text-slate-400 leading-snug">{p.subtitle}</span>
              <span className="mt-auto pt-3 text-[10px] font-bold uppercase tracking-widest text-slate-300">
                No disponible
              </span>
            </ProcessCardShell>
          ))}
        </div>
      </section>

      <Link
        to="/import-sgde"
        className="flex items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/50 px-6 py-5 transition-all hover:border-violet-300 hover:bg-violet-50"
      >
        <div className="text-left">
          <p className="text-sm font-black text-violet-900">¿Ya está en SGDE?</p>
          <p className="mt-1 text-xs font-medium text-violet-800/80 leading-relaxed">
            Importar a Tutelia: bajar PDF, crear o abrir el caso y vincular en un solo paso (sin crear de nuevo en
            SGDE).
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 text-[10px] font-black uppercase tracking-widest text-violet-700">
          <CloudDownload className="h-4 w-4" />
          Importar
        </span>
      </Link>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 flex items-center gap-3 text-sm font-semibold">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
    </motion.div>
  );
}
