import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight, CloudDownload, FileText, Loader2, Sparkles, Upload } from 'lucide-react';

export type CaseEmailParserProps = {
  file: File | null;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onParseEmail: () => void | Promise<void>;
  isParsing: boolean;
  error: string | null;
};

export function CaseEmailParser({
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
      <div className="rounded-2xl border border-blue-100 bg-blue-50/50 px-5 py-4 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-accent">Radicación única</p>
          <p className="text-sm font-semibold text-slate-800 mt-1 leading-snug">
            Cargue el correo judicial. La IA identificará el tipo de proceso (tutela, impugnación, civil,
            desacato, etc.) a partir del contenido y los anexos.
          </p>
        </div>
      </div>

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
          Buscar en este equipo
        </label>
      </div>

      {file && (
        <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-between border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-lg border border-slate-200 flex items-center justify-center">
              <FileText className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">{file.name}</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                {(file.size / 1024).toFixed(1)} KB · Listo para procesar
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onParseEmail()}
            disabled={isParsing}
            className="btn-primary flex items-center gap-2 px-6 disabled:opacity-60"
          >
            {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {isParsing ? 'Procesando…' : 'Procesar correo'}
          </button>
        </div>
      )}

      <Link
        to="/import-sgde"
        className="flex items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/50 px-6 py-5 transition-all hover:border-violet-300 hover:bg-violet-50"
      >
        <div className="text-left">
          <p className="text-sm font-black text-violet-900">¿Ya está en SGDE?</p>
          <p className="mt-1 text-xs font-medium text-violet-800/80 leading-relaxed">
            Importe el expediente desde SGDE sin volver a radicar desde correo.
          </p>
        </div>
        <CloudDownload className="h-6 w-6 shrink-0 text-violet-600" aria-hidden />
      </Link>

      {error ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </motion.div>
  );
}
