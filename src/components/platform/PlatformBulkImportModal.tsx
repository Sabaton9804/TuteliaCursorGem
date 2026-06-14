import React, { useRef, useState } from 'react';
import { X, Upload, FileSpreadsheet } from 'lucide-react';
import { parseCsvToObjects } from '../../lib/csv-parse';
import { bulkImportPlatformCourts, type BulkImportResult } from '../../services/platformCourtService';

type Props = {
  onClose: () => void;
  onImported: () => void;
};

function stripEmpty(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

export default function PlatformBulkImportModal({ onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const onFile = async (file: File | null) => {
    setError(null);
    setResult(null);
    if (!file) return;
    const text = await file.text();
    const rows = parseCsvToObjects(text).map(stripEmpty);
    if (rows.length === 0) {
      setError('El CSV no tiene filas de datos (encabezado + al menos una fila).');
      setPreview([]);
      setFileName(null);
      return;
    }
    if (!rows.some((r) => r.name)) {
      setError('Falta columna name en el encabezado.');
    }
    setPreview(rows);
    setFileName(file.name);
  };

  const submit = async () => {
    if (preview.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await bulkImportPlatformCourts(preview);
      setResult(res);
      if (res.summary.errors === 0) onImported();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">Importar despachos (CSV)</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            Columnas: <code className="text-xs bg-slate-100 px-1 rounded">name</code> (obligatorio), CUI vía{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">cui_12</code> o{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">dane_code+entity_code+specialty_code+despacho_number</code>
            , opcionalmente <code className="text-xs bg-slate-100 px-1 rounded">specialty</code>,{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">entity_category</code>, email, city, status.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-indigo-300 text-indigo-800 text-sm font-semibold hover:bg-indigo-50 w-full justify-center"
          >
            <Upload className="w-4 h-4" />
            {fileName ? fileName : 'Seleccionar archivo CSV'}
          </button>

          {preview.length > 0 && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <p className="text-xs font-bold text-slate-500 px-3 py-2 bg-slate-50 border-b border-slate-100">
                Vista previa ({preview.length} fila{preview.length === 1 ? '' : 's'})
              </p>
              <ul className="divide-y divide-slate-100 max-h-40 overflow-y-auto text-sm">
                {preview.slice(0, 8).map((r, i) => (
                  <li key={i} className="px-3 py-2 truncate">
                    <span className="font-medium text-slate-900">{r.name || '—'}</span>
                    <span className="text-slate-500 text-xs ml-2 font-mono">
                      {r.cui_12 || [r.dane_code, r.entity_code, r.specialty_code, r.despacho_number].filter(Boolean).join('-') || 'sin CUI'}
                    </span>
                  </li>
                ))}
                {preview.length > 8 && (
                  <li className="px-3 py-2 text-xs text-slate-500">… y {preview.length - 8} más</li>
                )}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {result && (
            <div
              className={`rounded-xl p-3 text-sm ${
                result.summary.errors > 0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'
              }`}
            >
              Insertados: {result.summary.inserted} · Actualizados: {result.summary.updated} · Errores:{' '}
              {result.summary.errors}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Cerrar
            </button>
            <button
              type="button"
              disabled={preview.length === 0 || importing}
              onClick={() => void submit()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-indigo-700"
            >
              {importing ? 'Importando…' : `Importar ${preview.length || ''} fila${preview.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
