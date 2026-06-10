import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import type { CaseType } from '../../types';
import {
  actRequiresPartyEntity,
  suggestedLogicalNameForAct,
  uploadableActsForCaseType,
} from '../../lib/case-act-types';

export type ExpedienteUploadActPayload = {
  actCode: string;
  partyEntity?: string;
  files: File[];
  notebookCode: string;
};

type Props = {
  open: boolean;
  files: File[];
  notebookCode: string;
  caseType?: CaseType | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (payload: ExpedienteUploadActPayload) => void | Promise<void>;
};

export function ExpedienteUploadActDialog({
  open,
  files,
  notebookCode,
  caseType,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const actOptions = useMemo(() => uploadableActsForCaseType(caseType), [caseType]);
  const [actCode, setActCode] = useState('');
  const [partyEntity, setPartyEntity] = useState('');

  useEffect(() => {
    if (!open) return;
    setActCode(actOptions[0]?.code ?? '');
    setPartyEntity('');
  }, [open, actOptions]);

  if (!open || files.length === 0) return null;

  const needsParty = actRequiresPartyEntity(actCode);
  const canSubmit = Boolean(actCode) && (!needsParty || partyEntity.trim().length > 0);
  const previewName = actCode
    ? suggestedLogicalNameForAct(actCode, {
        partyEntity: partyEntity.trim() || undefined,
        originalFilename: files[0]?.name,
      })
    : '';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-act-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Expediente</p>
            <h2 id="upload-act-title" className="text-lg font-bold text-slate-900">
              Tipo de acto procesal
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {files.length === 1
                ? `1 archivo: ${files[0].name}`
                : `${files.length} archivos (mismo acto para todos)`}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {actOptions.length === 0 ? (
          <p className="mt-4 text-sm text-amber-800">
            Este tipo de proceso aún no tiene catálogo de actos. Suba sin tipar o aplique la migración de actos.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Acto
              <select
                className="input-modern mt-1 w-full text-sm"
                value={actCode}
                disabled={busy}
                onChange={(e) => setActCode(e.target.value)}
              >
                {actOptions.map((a) => (
                  <option key={a.code} value={a.code}>
                    {String(a.sortBand).padStart(2, '0')} · {a.labelEs}
                  </option>
                ))}
              </select>
            </label>

            {needsParty ? (
              <label className="block text-xs font-semibold text-slate-700">
                Entidad accionada
                <input
                  type="text"
                  className="input-modern mt-1 w-full text-sm"
                  placeholder="Ej. Colpensiones, Nueva EPS…"
                  value={partyEntity}
                  disabled={busy}
                  onChange={(e) => setPartyEntity(e.target.value)}
                />
              </label>
            ) : null}

            {previewName ? (
              <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                Nombre sugerido: <span className="font-mono font-semibold text-slate-800">{previewName}</span>
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit || actOptions.length === 0}
            onClick={() =>
              void onConfirm({
                actCode,
                partyEntity: partyEntity.trim() || undefined,
                files,
                notebookCode,
              })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Subir al expediente
          </button>
        </div>
      </div>
    </div>
  );
}
