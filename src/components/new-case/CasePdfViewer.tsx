import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { FileText, AlertCircle, Loader2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { Document, Page } from 'react-pdf';
import { looksLikePdf } from '../../lib/pdf-sniff';
import { logPdfViewerDebug } from '../../lib/pdf-payload-debug';
import { fetchParseSessionAttachment } from '../../lib/parse-session-attachment';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const PDF_VIEWER_ZOOM_SCALES = [0.5, 0.75, 1.0, 1.25, 1.5] as const;
type PdfViewerZoom = 'fit' | (typeof PDF_VIEWER_ZOOM_SCALES)[number];

export type CasePdfViewerProps = {
  content?: string;
  /** PDF ya decodificado (evita base64 + atob en el navegador). */
  pdfBytes?: Uint8Array | null;
  contentType?: string;
  filename: string;
  parseSessionId?: string | null;
  sessionIndex?: number | null;
  /** scroll: todas las páginas en columna con desplazamiento vertical */
  displayMode?: 'scroll' | 'paginated';
};

export function CasePdfViewer({
  content,
  pdfBytes,
  contentType,
  filename,
  parseSessionId,
  sessionIndex,
  displayMode = 'scroll',
}: CasePdfViewerProps) {
  const scrollAllPages = displayMode === 'scroll';
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState<PdfViewerZoom>('fit');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitWidthPx, setFitWidthPx] = useState(() =>
    typeof window !== 'undefined' ? Math.max(240, Math.floor(window.innerWidth * 0.42)) : 640
  );
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfJsError, setPdfJsError] = useState<string | null>(null);
  const [remoteBytes, setRemoteBytes] = useState<Uint8Array | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const pdfOpenedRef = useRef(false);
  const pdfDebugOpenTsRef = useRef(0);

  const hasInlinePayload = Boolean(
    (typeof content === 'string' && content.length > 0) || (pdfBytes && pdfBytes.length > 0)
  );
  const useSession =
    !hasInlinePayload &&
    Boolean(parseSessionId) &&
    typeof sessionIndex === 'number' &&
    sessionIndex >= 0;

  useEffect(() => {
    if (!useSession || !parseSessionId) {
      setRemoteBytes(null);
      setRemoteError(null);
      setRemoteLoading(false);
      return;
    }
    let cancelled = false;
    setRemoteLoading(true);
    setRemoteError(null);
    setRemoteBytes(null);
    void (async () => {
      try {
        const u8 = await fetchParseSessionAttachment(parseSessionId, sessionIndex!);
        if (cancelled) return;
        setRemoteBytes(u8);
      } catch (e) {
        if (cancelled) return;
        setRemoteError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useSession, parseSessionId, sessionIndex, filename]);

  const decodedBytes = useMemo(() => {
    if (useSession) return remoteBytes;
    if (pdfBytes?.length) return pdfBytes;
    if (!content) return null;
    try {
      const binary = atob(content);
      const len = binary.length;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
      return arr;
    } catch {
      return null;
    }
  }, [useSession, remoteBytes, pdfBytes, content]);

  useEffect(() => {
    setPdfJsError(null);
  }, [content, contentType, parseSessionId, sessionIndex]);

  useEffect(() => {
    if (!decodedBytes) {
      setPdfBlob(null);
      return;
    }
    const blob = new Blob([decodedBytes], { type: contentType || 'application/pdf' });
    setPdfBlob(blob);
  }, [contentType, decodedBytes]);

  useEffect(() => {
    if (!decodedBytes) {
      setDownloadUrl('');
      return;
    }
    if (content) {
      setDownloadUrl(`data:${contentType || 'application/octet-stream'};base64,${content}`);
      return;
    }
    const b = new Blob([decodedBytes], { type: contentType || 'application/octet-stream' });
    const u = URL.createObjectURL(b);
    setDownloadUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [content, contentType, decodedBytes]);

  const isImageCt = Boolean(contentType?.startsWith('image/'));
  const isNonPdfBytes =
    Boolean(decodedBytes) && !isImageCt && !looksLikePdf(decodedBytes!);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      setFitWidthPx(Math.max(240, Math.floor(el.clientWidth - pl - pr)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdfBlob, pdfJsError, isImageCt, isNonPdfBytes]);

  useEffect(() => {
    if (import.meta.env.DEV && pdfBlob && !isImageCt && !isNonPdfBytes && decodedBytes) {
      pdfDebugOpenTsRef.current = performance.now();
      logPdfViewerDebug({
        where: 'NewCase.PdfViewer',
        phase: 'open',
        filename,
        contentType,
        bytes: decodedBytes,
      });
    }
  }, [pdfBlob, isImageCt, isNonPdfBytes, decodedBytes, filename, contentType]);

  useEffect(() => {
    pdfOpenedRef.current = false;
    if (!pdfBlob || isImageCt || isNonPdfBytes) return;
    const t = window.setTimeout(() => {
      if (!pdfOpenedRef.current) {
        if (import.meta.env.DEV && decodedBytes) {
          logPdfViewerDebug({
            where: 'NewCase.PdfViewer',
            phase: 'timeout',
            filename,
            contentType,
            bytes: decodedBytes,
            msSinceOpen: performance.now() - pdfDebugOpenTsRef.current,
            message: '35s sin onLoadSuccess (PDF.js no terminó de abrir el documento)',
          });
        }
        setPdfJsError(
          (e) =>
            e ??
            'Tiempo de espera (35 s) al renderizar el PDF. Use «Descargar» abajo o abra el archivo en otro visor.'
        );
      }
    }, 35000);
    return () => window.clearTimeout(t);
  }, [pdfBlob, isImageCt, isNonPdfBytes, decodedBytes, filename, contentType]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    pdfOpenedRef.current = true;
    setPdfJsError(null);
    if (import.meta.env.DEV && decodedBytes) {
      logPdfViewerDebug({
        where: 'NewCase.PdfViewer',
        phase: 'load-ok',
        filename,
        contentType,
        bytes: decodedBytes,
        msSinceOpen: performance.now() - pdfDebugOpenTsRef.current,
        message: `numPages=${numPages}`,
      });
    }
    setNumPages(numPages);
    if (!scrollAllPages) setPageNumber(1);
  }

  const legacyNoPayload = !useSession && !content && !(pdfBytes && pdfBytes.length > 0);
  if (legacyNoPayload) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
        <div className="w-24 h-24 bg-white rounded-3xl shadow-sm flex items-center justify-center">
          <FileText className="w-12 h-12 text-slate-200" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-700">{filename}</h3>
          <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
            Vista previa generada para radicación electrónica. Pulse radicar para procesar el expediente completo.
          </p>
        </div>
        <div className="w-full max-w-md h-64 bg-white/50 border border-slate-200 border-dashed rounded-2xl flex items-center justify-center">
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
            Sin vista previa (adjunto no cargado)
          </span>
        </div>
      </div>
    );
  }

  if (useSession && remoteLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-xs font-bold uppercase tracking-widest">Obteniendo adjunto del servidor…</p>
        <p className="text-[10px] text-slate-400 mt-2 max-w-xs text-center">{filename}</p>
      </div>
    );
  }

  if (useSession && remoteError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-amber-500" />
        <p className="text-sm font-bold text-slate-800">No se pudo cargar el adjunto</p>
        <p className="text-xs text-slate-500">{remoteError}</p>
        <p className="text-[10px] text-slate-400">
          Vuelva a cargar el archivo .eml (sobre todo si reinició el servidor o pasaron varias horas).
        </p>
      </div>
    );
  }

  if (!decodedBytes) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-amber-500" />
        <p className="text-sm font-bold text-slate-700">No se pudo decodificar el adjunto (base64 inválido).</p>
        <p className="text-xs text-slate-500">{filename}</p>
      </div>
    );
  }

  if (!isImageCt && !looksLikePdf(decodedBytes)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4 bg-slate-50">
        <AlertCircle className="w-10 h-10 text-amber-500" />
        <p className="text-sm font-bold text-slate-800">El contenido no es un PDF</p>
        <p className="text-xs text-slate-500 max-w-md leading-relaxed">
          Suele ocurrir cuando el enlace «Archivo» (p. ej. Safelinks de Outlook) devuelve una página web en lugar del PDF.
          Abra el enlace en el navegador, descargue el PDF y adjúntelo al correo o cargue un .eml tras tener el archivo real.
        </p>
        {downloadUrl ? (
          <a
            href={downloadUrl}
            download={filename}
            className="text-[10px] font-bold text-accent hover:underline flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg"
          >
            <ExternalLink className="w-3 h-3" /> Descargar respuesta y revisar
          </a>
        ) : null}
      </div>
    );
  }

  if (pdfJsError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4">
        <p className="text-sm font-bold text-slate-800">No se pudo mostrar el PDF</p>
        <p className="text-xs text-slate-500">{pdfJsError}</p>
        {downloadUrl ? (
          <a href={downloadUrl} download={filename} className="text-[10px] font-bold text-accent hover:underline">
            Descargar y abrir con otro visor
          </a>
        ) : null}
      </div>
    );
  }

  if (isImageCt && pdfBlob) {
    const imageUrl = URL.createObjectURL(pdfBlob);
    return (
      <div className="flex-1 overflow-auto bg-slate-200 p-8 flex items-center justify-center">
        <img
          src={imageUrl}
          alt={filename}
          className="max-w-full shadow-2xl rounded-sm"
          onLoad={() => URL.revokeObjectURL(imageUrl)}
        />
      </div>
    );
  }

  const pageWidthProp = zoom === 'fit' && fitWidthPx > 0 ? fitWidthPx : undefined;
  const pageScaleProp = zoom === 'fit' ? 1 : zoom;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 overflow-hidden min-w-0">
      <div
        ref={viewportRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex justify-center min-w-0"
      >
        {pdfBlob ? (
          <div
            className={`max-w-full ${scrollAllPages ? 'flex flex-col items-center gap-4 pb-2' : 'shadow-2xl'}`}
          >
            <Document
              file={pdfBlob}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={(err) => {
                console.error('react-pdf onLoadError:', err);
                if (import.meta.env.DEV && decodedBytes) {
                  logPdfViewerDebug({
                    where: 'NewCase.PdfViewer',
                    phase: 'load-fail',
                    filename,
                    contentType,
                    bytes: decodedBytes,
                    msSinceOpen: performance.now() - pdfDebugOpenTsRef.current,
                    message: err?.message || String(err),
                  });
                }
                setPdfJsError(err?.message || 'Error al leer el documento con PDF.js');
              }}
              onSourceError={(err) => {
                console.error('react-pdf onSourceError:', err);
                if (import.meta.env.DEV && decodedBytes) {
                  logPdfViewerDebug({
                    where: 'NewCase.PdfViewer',
                    phase: 'source-fail',
                    filename,
                    contentType,
                    bytes: decodedBytes,
                    msSinceOpen: performance.now() - pdfDebugOpenTsRef.current,
                    message: err?.message || String(err),
                  });
                }
                setPdfJsError(err?.message || 'Error al leer los bytes del PDF');
              }}
              loading={
                <div className="flex flex-col items-center justify-center p-20 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-4" />
                  <p className="text-xs font-bold uppercase tracking-widest">Renderizando PDF...</p>
                </div>
              }
              error={
                <div className="p-20 text-center text-red-500">
                  <p className="text-sm font-bold">Error al cargar el PDF</p>
                </div>
              }
            >
              {scrollAllPages && numPages
                ? Array.from({ length: numPages }, (_, i) => (
                    <Page
                      key={`page-${i + 1}`}
                      pageNumber={i + 1}
                      width={pageWidthProp}
                      scale={pageScaleProp}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      className="max-w-full shadow-lg rounded-sm bg-white"
                    />
                  ))
                : (
                    <Page
                      pageNumber={pageNumber}
                      width={pageWidthProp}
                      scale={pageScaleProp}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      className="max-w-full"
                    />
                  )}
            </Document>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-slate-200" />
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {scrollAllPages ? (
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {numPages ? `${numPages} página${numPages === 1 ? '' : 's'}` : 'Cargando…'} · desplácese para ver todo
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <button
                disabled={pageNumber <= 1}
                onClick={() => setPageNumber((prev) => prev - 1)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-accent hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest w-24 text-center">
                PÁGINA {pageNumber} / {numPages || '?'}
              </span>
              <button
                disabled={numPages === null || pageNumber >= numPages}
                onClick={() => setPageNumber((prev) => prev + 1)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-accent hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          <select
            value={zoom === 'fit' ? 'fit' : String(zoom)}
            onChange={(e) => {
              const v = e.target.value;
              setZoom(v === 'fit' ? 'fit' : (Number(v) as PdfViewerZoom));
            }}
            className="text-[10px] font-bold text-slate-500 uppercase bg-transparent border-none focus:ring-0 cursor-pointer max-w-[11rem]"
            title="Ajustar ancho encaja hojas horizontales en el panel"
          >
            <option value="fit">Ajustar ancho</option>
            {PDF_VIEWER_ZOOM_SCALES.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </div>

        {downloadUrl ? (
          <a
            href={downloadUrl}
            download={filename}
            className="text-[10px] font-bold text-accent hover:underline flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg"
          >
            <ExternalLink className="w-3 h-3" /> SI LA VISTA NO CARGA, PULSE AQUÍ PARA DESCARGAR
          </a>
        ) : null}
      </div>
    </div>
  );
}
