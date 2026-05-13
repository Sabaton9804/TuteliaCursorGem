import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, FileText, Loader2, Upload } from 'lucide-react';
import type { CaseType } from '../../types';
import { CASE_TYPE_CARD_COPY } from '../../hooks/useNewCaseForm';

export type CaseEmailParserProps = {
  caseFlowType: CaseType;
  onChangeCaseFlowType: () => void;
  /** Bloque de campos de origen (segunda instancia / consulta desacato) o null. */
  originFields: React.ReactNode;
  file: File | null;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onParseEmail: () => void | Promise<void>;
  isParsing: boolean;
  error: string | null;
};

export function CaseEmailParser({
  caseFlowType,
  onChangeCaseFlowType,
  originFields,
  file,
  onFileInputChange,
  onDrop,
  onParseEmail,
  isParsing,
  error,
}: CaseEmailParserProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-modern p-12 space-y-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-blue-100 bg-blue-50/50 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-accent">Tipo de expediente</p>
          <p className="text-sm font-bold text-slate-800 mt-1 leading-snug">
            <span className="mr-2" aria-hidden>
              {CASE_TYPE_CARD_COPY[caseFlowType].emoji}
            </span>
            {CASE_TYPE_CARD_COPY[caseFlowType].title} — {CASE_TYPE_CARD_COPY[caseFlowType].subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onChangeCaseFlowType}
          className="shrink-0 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-accent underline-offset-4 hover:underline text-left sm:text-right"
        >
          Cambiar tipo
        </button>
      </div>

      {originFields}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="border-2 border-dashed border-slate-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center space-y-6 hover:border-accent hover:bg-blue-50/30 transition-all cursor-pointer group"
      >
        <div className="w-20 h-20 bg-slate-50 group-hover:bg-blue-100 rounded-3xl flex items-center justify-center transition-colors">
          <Upload className="w-10 h-10 text-slate-400 group-hover:text-accent" />
        </div>
        <div>
          <p className="text-lg font-bold text-slate-700">Arrastre el correo electrónico aquí</p>
          <p className="text-sm text-slate-400 mt-2 font-medium">Soportamos archivos .eml y .msg extraídos de Outlook</p>
        </div>

        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept=".eml,.msg"
          onChange={onFileInputChange}
        />
        <label
          htmlFor="file-upload"
          className="px-8 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm text-slate-600 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-all shadow-sm"
        >
          BUSCAR EN ESTE EQUIPO
        </label>

        {file && (
          <div className="flex items-center gap-3 mt-4 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100 animate-in fade-in zoom-in duration-300 text-xs font-bold">
            <FileText className="w-4 h-4" />
            {file.name}
          </div>
        )}
      </div>

      {file && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-2">
          <button
            type="button"
            onClick={() => void onParseEmail()}
            disabled={isParsing}
            className="btn-primary w-full flex items-center justify-center gap-3 text-lg py-5 shadow-lg shadow-accent/20"
          >
            {isParsing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                ANALIZANDO CONTENIDO Y ANEXOS...
              </>
            ) : (
              <>
                PROCESAR E INGESTAR EXPEDIENTE
                <ArrowRight className="w-6 h-6" />
              </>
            )}
          </button>
        </motion.div>
      )}

      {error && (
        <div className="mt-2 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 flex items-center gap-3 text-sm font-semibold">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
    </motion.div>
  );
}
