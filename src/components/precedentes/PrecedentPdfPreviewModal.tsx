import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react';
import { Document, Page } from 'react-pdf';
import { formatRadicado } from '../../lib/formatters';
import { PRECEDENT_RADICADO_PENDIENTE } from '../../lib/precedent-constants';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

type Props = {
  precedentId: string;
  radicado: string;
  rulingSense: string;
  rightProtected: string;
  fetchPdfUrl: (precedentId: string) => Promise<string>;
  onClose: () => void;
  onOpenNewTab: (precedentId: string) => Promise<void>;
};

function radicadoTitulo(radicado: string): string {
  if (!radicado || radicado === PRECEDENT_RADICADO_PENDIENTE) return 'Sin radicado';
  return formatRadicado(radicado);
}

export function PrecedentPdfPreviewModal({
  precedentId,
  radicado,
  rulingSense,
  rightProtected,
  fetchPdfUrl,
  onClose,
  onOpenNewTab,
}: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pdfJsError, setPdfJsError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitWidthPx, setFitWidthPx] = useState(720);
  const [tabBusy, setTabBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    setSignedUrl(null);
    setPdfJsError(null);
    setNumPages(null);
    setPageNumber(1);
    void (async () => {
      try {
        const url = await fetchPdfUrl(precedentId);
        if (!cancelled) setSignedUrl(url);
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'No se pudo cargar el PDF');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [precedentId, fetchPdfUrl]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      setFitWidthPx(Math.max(280, Math.floor(el.clientWidth - pl - pr)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [signedUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const downloadName = `Fallo_${radicado.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40) || 'precedente'}.pdf`;

  return (
    <section
      className="fixed inset-0 z-[200] flex flex-col bg-slate-900/55 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="precedent-pdf-preview-title"
      onClick={onClose}
    >
      <article
        className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/90 px-4 py-3 sm:px-5">
          <section className="min-w-0 flex-1">
            <h2 id="precedent-pdf-preview-title" className="truncate text-sm font-bold text-slate-900 sm:text-base">
              {radicadoTitulo(radicado)}
            </h2>
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{rightProtected}</p>
            {rulingSense ? (
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{rulingSense}</p>
            ) : null}
          </section>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Acciones del visor">
            <button
              type="button"
              disabled={tabBusy || !signedUrl}
              onClick={() => {
                setTabBusy(true);
                void onOpenNewTab(precedentId).finally(() => setTabBusy(false));
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {tabBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ExternalLink className="h-3.5 w-3.5" aria-hidden />}
              Nueva pestaña
            </button>
            {signedUrl ? (
              <a
                href={signedUrl}
                download={downloadName}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Descargar
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Cerrar visor"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </nav>
        </header>
        <main ref={viewportRef} className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          {loadErr ? (
            <section className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <AlertCircle className="h-10 w-10 text-rose-500" aria-hidden />
              <p className="max-w-md text-sm font-medium text-rose-900">{loadErr}</p>
            </section>
          ) : !signedUrl ? (
            <section className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
              <p className="text-xs font-bold uppercase tracking-widest">Cargando PDF…</p>
            </section>
          ) : pdfJsError ? (
            <section className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <AlertCircle className="h-10 w-10 text-amber-500" aria-hidden />
              <p className="text-sm font-bold text-slate-800">No se pudo mostrar el PDF</p>
              <p className="max-w-md text-xs text-slate-600">{pdfJsError}</p>
            </section>
          ) : (
            <section className="flex flex-col items-center gap-4">
              <Document
                file={signedUrl}
                onLoadSuccess={({ numPages: n }) => {
                  setNumPages(n);
                  setPageNumber(1);
                  setPdfJsError(null);
                }}
                onLoadError={(err) => {
                  setPdfJsError(err?.message || 'Error al leer el documento');
                }}
                loading={
                  <section className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
                    <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
                    <p className="text-xs font-bold uppercase tracking-widest">Renderizando…</p>
                  </section>
                }
              >
                <Page pageNumber={pageNumber} width={fitWidthPx} className="shadow-lg" />
              </Document>
              {numPages != null && numPages > 1 ? (
                <nav className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs shadow-sm" aria-label="Paginación">
                  <button
                    type="button"
                    disabled={pageNumber <= 1}
                    onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                    className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <span className="tabular-nums font-semibold text-slate-700">
                    {pageNumber} / {numPages}
                  </span>
                  <button
                    type="button"
                    disabled={pageNumber >= numPages}
                    onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                    className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Página siguiente"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </nav>
              ) : null}
            </section>
          )}
        </main>
      </article>
    </section>
  );
}

