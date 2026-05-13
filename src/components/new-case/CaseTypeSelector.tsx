import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import type { CaseType } from '../../types';
import { CASE_TYPE_CARD_COPY } from '../../hooks/useNewCaseForm';

type Props = {
  error: string | null;
  onSelectCaseType: (t: CaseType) => void;
  onClearError: () => void;
};

export function CaseTypeSelector({ error, onSelectCaseType, onClearError }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <p className="text-center text-sm font-medium text-slate-600 max-w-2xl mx-auto leading-relaxed">
        Seleccione el tipo de asunto. Según su elección se solicitarán datos de origen cuando aplique y se guardará la
        clasificación en Supabase (<span className="font-mono text-xs">case_type</span>).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(['tutela_primera', 'tutela_segunda', 'consulta_desacato'] as const).map((key) => {
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
      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 flex items-center gap-3 text-sm font-semibold">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
    </motion.div>
  );
}
