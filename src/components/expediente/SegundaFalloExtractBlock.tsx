import React from 'react';
import { Loader2, Scale } from 'lucide-react';
import type { FalloPickerOption } from '../../lib/segunda-fallo-parties';

export type SegundaFalloExtractBlockProps = {
  options: FalloPickerOption[];
  selectedDocumentId: string;
  onSelectDocumentId: (id: string) => void;
  extracting: boolean;
  onExtract: (documentId: string) => void | Promise<void>;
  statusMessage?: string | null;
  onGoToExpediente?: () => void;
  compact?: boolean;
};

export function SegundaFalloExtractBlock({
  options,
  selectedDocumentId,
  onSelectDocumentId,
  extracting,
  onExtract,
  statusMessage,
  onGoToExpediente,
  compact = false,
}: SegundaFalloExtractBlockProps) {
  if (options.length === 0) {
    return (
      <div className={`rounded-xl border border-amber-100 bg-amber-50/80 ${compact ? 'p-4' : 'p-6'} text-left`}>
        <p className="text-sm font-medium text-amber-900">No hay PDF de primera instancia en Storage.</p>
        <p className="mt-1 text-xs text-amber-800/90">
          Migre el expediente desde SGDE (Expediente digital) o suba el fallo de primera instancia antes de extraer
          partes.
        </p>
        {onGoToExpediente ? (
          <button
            type="button"
            onClick={onGoToExpediente}
            className="mt-3 text-[10px] font-bold uppercase tracking-wide text-amber-900 underline hover:no-underline"
          >
            Ir a expediente digital
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-sky-100 bg-sky-50/40 text-left ${compact ? 'p-4 space-y-3' : 'p-6 space-y-4 max-w-lg mx-auto'}`}
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
          Fallo de primera instancia (fuente)
        </p>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          Si la detección automática falla o elige mal el documento, indique cuál PDF contiene el fallo que resolvió
          la tutela en el juzgado de origen.
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Documento</span>
        <select
          className="input-modern w-full bg-white py-2 text-sm"
          value={selectedDocumentId}
          onChange={(e) => onSelectDocumentId(e.target.value)}
          disabled={extracting}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.suggested ? '★ ' : ''}
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => void onExtract(selectedDocumentId)}
        disabled={extracting || !selectedDocumentId}
        className="btn-primary w-full sm:w-auto px-6 py-2.5 text-xs inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {extracting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Scale className="h-4 w-4" aria-hidden />}
        Extraer partes y hechos
      </button>
      {statusMessage ? <p className="text-xs text-slate-600">{statusMessage}</p> : null}
    </div>
  );
}
