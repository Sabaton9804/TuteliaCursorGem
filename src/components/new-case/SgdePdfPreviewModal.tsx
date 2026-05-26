import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { CasePdfViewer } from './CasePdfViewer';
import { sgdePreviewNodeBytes } from '../../lib/sgde-api';
import { getSgdePreviewFromCache, setSgdePreviewCache } from '../../lib/sgde-preview-cache';

type Props = {
  nodeId: string;
  displayName: string;
  onClose: () => void;
};

export function SgdePdfPreviewModal({ nodeId, displayName, onClose }: Props) {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [contentType, setContentType] = useState('application/pdf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = getSgdePreviewFromCache(nodeId);
    if (cached) {
      setPdfBytes(cached.bytes);
      setContentType(cached.contentType);
      setFromCache(true);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setPdfBytes(null);
    setFromCache(false);
    void (async () => {
      try {
        const body = await sgdePreviewNodeBytes(nodeId);
        if (cancelled) return;
        setSgdePreviewCache(nodeId, body.bytes, body.contentType);
        setPdfBytes(body.bytes);
        setContentType(body.contentType);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar el PDF.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sgde-pdf-preview-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 id="sgde-pdf-preview-title" className="truncate text-sm font-bold text-slate-900">
              {displayName}
            </h2>
            {fromCache ? (
              <p className="text-[10px] text-emerald-700">Cargado desde caché local (más rápido)</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar visor"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Descargando desde SGDE…
            </p>
          ) : error ? (
            <p className="flex items-center gap-2 py-8 text-sm text-red-700">
              <AlertCircle className="h-5 w-5 shrink-0" />
              {error}
            </p>
          ) : pdfBytes ? (
            <CasePdfViewer pdfBytes={pdfBytes} contentType={contentType} filename={displayName} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
