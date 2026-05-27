import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { FileText, ExternalLink, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { Document, Page } from 'react-pdf';
import { supabase } from '../../lib/supabase';
import { looksLikePdf } from '../../lib/pdf-sniff';
import { logPdfViewerDebug } from '../../lib/pdf-payload-debug';
import {
  CASE_DOCUMENTS_BUCKET,
  CASE_DOCUMENT_SIGNED_URL_TTL_SEC,
} from '../../lib/case-document-storage';
import { sanitizeExpedienteFilenameForDisplay } from '../../lib/sanitize-expediente-filename';
import { caseDocumentRawLabel } from '../../lib/case-document-display-name';
import { ExpedienteDigitalPanel } from './ExpedienteDigitalPanel';
import { ExpedientePieceAiPanel } from './ExpedientePieceAiPanel';
import { isCaseDocumentPdf } from '../../lib/expediente-docx';
import { ExpedienteSgdeBar } from './ExpedienteSgdeBar';
import { ExpedienteDocxPreview } from './ExpedienteDocxPreview';
import { isCaseDocumentDocx } from '../../lib/expediente-docx';
import type { Case, Document as CaseDoc } from '../../types';
import {
  isCaseDocumentOpenableInViewer,
  primeraPiezaParaAbrir,
} from '../../lib/expediente-viewer-doc';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';


function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const len = binary.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  } catch {
    return null;
  }
}

const PDF_VIEWER_ZOOM_SCALES = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;
type PdfViewerZoom = 'fit' | (typeof PDF_VIEWER_ZOOM_SCALES)[number];

function stepPdfZoom(current: PdfViewerZoom, direction: -1 | 1): PdfViewerZoom {
  if (current === 'fit') return direction > 0 ? 1.0 : 0.75;
  const idx = PDF_VIEWER_ZOOM_SCALES.indexOf(current);
  if (idx < 0) return 1.0;
  const next = idx + direction;
  if (next < 0) return PDF_VIEWER_ZOOM_SCALES[0];
  if (next >= PDF_VIEWER_ZOOM_SCALES.length) return PDF_VIEWER_ZOOM_SCALES[PDF_VIEWER_ZOOM_SCALES.length - 1];
  return PDF_VIEWER_ZOOM_SCALES[next];
}

function pdfZoomLabel(zoom: PdfViewerZoom): string {
  return zoom === 'fit' ? 'Ajustar ancho' : `${Math.round(zoom * 100)}%`;
}

function PdfViewer({
  content,
  contentType,
  filename,
  onBack,
  ingestError,
  storagePath,
  onPageCountChange,
}: {
  content?: string;
  contentType?: string;
  filename: string;
  onBack?: () => void;
  ingestError?: string;
  /** Ruta en bucket `case-documents` (columna `storage_path`). */
  storagePath?: string;
  onPageCountChange?: (count: number | null) => void;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [zoom, setZoom] = useState<PdfViewerZoom>('fit');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitWidthPx, setFitWidthPx] = useState(() =>
    typeof window !== 'undefined' ? Math.max(240, Math.floor(window.innerWidth * 0.42)) : 640
  );
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfJsError, setPdfJsError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  const pathTrim = storagePath?.trim() ?? '';
  const hasStorage = Boolean(pathTrim);
  const hasContent = Boolean(content && content.length > 0);

  const bytes = useMemo(() => (content ? base64ToBytes(content) : null), [content]);
  const isImage = Boolean(contentType?.startsWith('image/'));
  const pdfOpenedRef = useRef(false);
  const pdfDebugOpenTsRef = useRef(0);

  useEffect(() => {
    setPdfJsError(null);
    setNumPages(null);
    setZoom('fit');
    onPageCountChange?.(null);
  }, [content, storagePath, onPageCountChange]);

  const documentFile = signedUrl || pdfBlob;

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
  }, [documentFile, pdfJsError, isImage]);

  useEffect(() => {
    if (!pathTrim) {
      setSignedUrl(null);
      setSignError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.storage
        .from(CASE_DOCUMENTS_BUCKET)
        .createSignedUrl(pathTrim, CASE_DOCUMENT_SIGNED_URL_TTL_SEC);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        setSignError(
          error?.message ||
            'No se pudo firmar la URL. Compruebe el bucket case-documents, políticas RLS de storage y la columna storage_path.'
        );
        setSignedUrl(null);
        return;
      }
      setSignedUrl(data.signedUrl);
      setSignError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathTrim]);

  useEffect(() => {
    if (!hasContent) {
      setPdfBlob(null);
      return;
    }
    if (!bytes) {
      setPdfBlob(null);
      return;
    }
    const blob = new Blob([bytes], { type: contentType || 'application/pdf' });
    setPdfBlob(blob);
  }, [hasContent, contentType, bytes]);

  useEffect(() => {
    const fileReady = Boolean(signedUrl || pdfBlob);
    const invalidLocal =
      !hasStorage && hasContent && Boolean(bytes) && !isImage && !looksLikePdf(bytes!);
    if (!import.meta.env.DEV || !fileReady || isImage || invalidLocal) return;
    pdfDebugOpenTsRef.current = performance.now();
    if (signedUrl) {
      logPdfViewerDebug({
        where: 'CaseDetail.PdfViewer',
        phase: 'open',
        filename,
        contentType,
        bytes: bytes && bytes.byteLength > 0 ? bytes : null,
        signedUrlPrefix: signedUrl.slice(0, 120),
      });
    } else if (bytes && bytes.byteLength > 0) {
      logPdfViewerDebug({
        where: 'CaseDetail.PdfViewer',
        phase: 'open',
        filename,
        contentType,
        bytes,
      });
    }
  }, [signedUrl, pdfBlob, isImage, hasStorage, hasContent, bytes, filename, contentType]);

  useEffect(() => {
    pdfOpenedRef.current = false;
    const fileReady = Boolean(signedUrl || pdfBlob);
    const invalidLocal =
      !hasStorage && hasContent && Boolean(bytes) && !isImage && !looksLikePdf(bytes!);
    if (!fileReady || isImage || invalidLocal) return;
    const t = window.setTimeout(() => {
      if (!pdfOpenedRef.current) {
        if (import.meta.env.DEV) {
          logPdfViewerDebug({
            where: 'CaseDetail.PdfViewer',
            phase: 'timeout',
            filename,
            contentType,
            bytes: bytes && bytes.byteLength > 0 ? bytes : null,
            signedUrlPrefix: signedUrl ? signedUrl.slice(0, 120) : undefined,
            msSinceOpen: performance.now() - pdfDebugOpenTsRef.current,
            message: '35s sin onLoadSuccess',
          });
        }
        setPdfJsError(
          (e) =>
            e ??
            'Tiempo de espera (35 s) al renderizar el PDF. Use el enlace de descarga o abra el adjunto en otra pestaña.'
        );
      }
    }, 35000);
    return () => window.clearTimeout(t);
  }, [signedUrl, pdfBlob, isImage, hasStorage, hasContent, bytes, filename, contentType]);

  function onDocumentLoadSuccess({ numPages: n }: { numPages: number }) {
    pdfOpenedRef.current = true;
    setPdfJsError(null);
    if (import.meta.env.DEV) {
      logPdfViewerDebug({
        where: 'CaseDetail.PdfViewer',
        phase: 'load-ok',
        filename,
        contentType,
        bytes: bytes && bytes.byteLength > 0 ? bytes : null,
        signedUrlPrefix: signedUrl ? signedUrl.slice(0, 120) : undefined,
        msSinceOpen: performance.now() - pdfDebugOpenTsRef.current,
        message: `numPages=${n}`,
      });
    }
    setNumPages(n);
    onPageCountChange?.(n);
  }

  if (!hasStorage && !hasContent) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center space-y-6 flex-1 min-h-0 max-w-lg mx-auto">
        <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center">
            <FileText className="w-10 h-10 text-slate-300" />
        </div>
        <div>
            <h4 className="text-lg font-bold text-slate-700">{filename}</h4>
            <p className="text-sm text-slate-500 mt-3 leading-relaxed">
              {ingestError ||
                'No hay adjunto en Storage ni base64 en base de datos. Radique de nuevo tras aplicar la migración de buckets, o restaure el archivo.'}
            </p>
        </div>
        <button 
          onClick={onBack}
          className="px-8 py-3 bg-white border border-slate-200 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
        >
            VOLVER AL EXPEDIENTE
        </button>
      </div>
    );
  }

  if (hasStorage && signError) {
    return (
      <div className="p-10 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-0 max-w-lg mx-auto">
        <p className="text-sm font-bold text-slate-800">No se pudo cargar el archivo desde Supabase Storage</p>
        <p className="text-xs text-slate-500 leading-relaxed">{signError}</p>
        <p className="text-[11px] text-slate-400 font-mono break-all">{pathTrim}</p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg"
          >
            Volver
          </button>
        )}
      </div>
    );
  }

  if (hasStorage && !signedUrl) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400 flex-1 min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-xs font-bold uppercase tracking-widest">Obteniendo adjunto desde Storage…</p>
      </div>
    );
  }

  if (!hasStorage && hasContent && !bytes) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-0">
        <p className="text-sm font-bold text-slate-700">No se pudo decodificar el archivo (base64 inválido o corrupto).</p>
        <p className="text-xs text-slate-500">{filename}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-8 py-3 bg-white border border-slate-200 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-50"
        >
          VOLVER AL REPARTO
        </button>
      </div>
    );
  }

  const isInvalidPdfPayload =
    !hasStorage &&
    hasContent &&
    Boolean(bytes) &&
    !isImage &&
    !looksLikePdf(bytes!);

  if (isInvalidPdfPayload) {
    return (
      <div className="p-10 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-0 max-w-lg mx-auto">
        <p className="text-sm font-bold text-slate-800">El adjunto no es un PDF válido</p>
        <p className="text-xs text-slate-500 leading-relaxed">
          Los enlaces de Outlook (Safelinks) a veces devuelven una página HTML en lugar del archivo. Descargue el PDF
          manualmente desde el correo y vuelva a cargar el .eml, o compruebe que el enlace «Archivo» apunte al PDF
          real.
        </p>
        <p className="text-[11px] text-slate-400 font-mono break-all">{filename}</p>
        {content ? (
          <a
            href={`data:${contentType || 'application/octet-stream'};base64,${content}`}
            download={filename}
            className="text-xs font-bold text-accent underline"
          >
            Descargar respuesta del servidor y revisar en el equipo
          </a>
        ) : null}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg"
          >
            Volver
          </button>
        )}
      </div>
    );
  }

  if (isImage && (pdfBlob || signedUrl)) {
    const imageUrl = signedUrl || (pdfBlob ? URL.createObjectURL(pdfBlob) : '');
    if (!imageUrl) {
      return (
        <div className="p-12 flex flex-col items-center justify-center flex-1 min-h-[400px] text-slate-400 text-sm">
          No hay vista previa de imagen.
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-auto bg-slate-200 p-8 flex items-center justify-center min-h-0">
        <img 
          src={imageUrl} 
          alt={filename} 
          className="max-w-full shadow-2xl rounded-sm"
          onLoad={() => {
            if (!signedUrl && pdfBlob) URL.revokeObjectURL(imageUrl);
          }}
        />
      </div>
    );
  }

  if (pdfJsError) {
    return (
      <div className="p-10 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-0 max-w-lg mx-auto">
        <p className="text-sm font-bold text-slate-800">No se pudo mostrar el PDF en el navegador</p>
        <p className="text-xs text-slate-500 leading-relaxed">{pdfJsError}</p>
        <p className="text-[11px] text-slate-400">
          Suele ocurrir si el archivo no es un PDF real (p. ej. HTML de error, ZIP renombrado) o está protegido con contraseña.
        </p>
        {content ? (
          <a
            href={`data:${contentType || 'application/pdf'};base64,${content}`}
            download={filename}
            className="text-xs font-bold text-accent underline"
          >
            Descargar (base64) y abrir con visor externo
          </a>
        ) : null}
        {signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-accent underline"
          >
            Abrir adjunto desde Storage en nueva pestaña
          </a>
        ) : null}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg"
          >
            Volver
          </button>
        )}
      </div>
    );
  }

  if (!documentFile) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-200" />
      </div>
    );
  }

  const pageWidthProp = zoom === 'fit' && fitWidthPx > 0 ? fitWidthPx : undefined;
  const pageScaleProp = zoom === 'fit' ? 1 : zoom;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100 min-w-0">
      <div
        ref={viewportRef}
        className="flex-1 overflow-auto p-4 flex justify-center min-w-0"
      >
        <div className="flex w-full max-w-full flex-col items-center gap-3 shadow-2xl">
          <Document
            file={documentFile}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => {
              console.error('react-pdf onLoadError:', err);
              if (import.meta.env.DEV) {
                logPdfViewerDebug({
                  where: 'CaseDetail.PdfViewer',
                  phase: 'load-fail',
                  filename,
                  contentType,
                  bytes: bytes && bytes.byteLength > 0 ? bytes : null,
                  signedUrlPrefix: signedUrl ? signedUrl.slice(0, 120) : undefined,
                  msSinceOpen: performance.now() - pdfDebugOpenTsRef.current,
                  message: err?.message || String(err),
                });
              }
              setPdfJsError(err?.message || 'Error al leer el documento con PDF.js');
            }}
            onSourceError={(err) => {
              console.error('react-pdf onSourceError:', err);
              if (import.meta.env.DEV) {
                logPdfViewerDebug({
                  where: 'CaseDetail.PdfViewer',
                  phase: 'source-fail',
                  filename,
                  contentType,
                  bytes: bytes && bytes.byteLength > 0 ? bytes : null,
                  signedUrlPrefix: signedUrl ? signedUrl.slice(0, 120) : undefined,
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
                <p className="text-[10px] text-slate-400 mt-4 max-w-sm text-center">
                  Si se queda mucho tiempo aquí, use el enlace de descarga abajo.
                </p>
              </div>
            }
            error={
              <div className="p-20 text-center text-red-500">
                <p className="text-sm font-bold">Error al cargar el PDF</p>
              </div>
            }
          >
            {numPages
              ? Array.from({ length: numPages }, (_, i) => (
                  <Page
                    key={`page-${i + 1}`}
                    pageNumber={i + 1}
                    width={pageWidthProp}
                    scale={pageScaleProp}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    className="mb-3 max-w-full shadow-md last:mb-0"
                  />
                ))
              : null}
          </Document>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {numPages ? `${numPages} pág. · scroll` : 'Cargando…'}
          </span>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Alejar"
              onClick={() => setZoom((z) => stepPdfZoom(z, -1))}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-accent"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <select
              value={zoom === 'fit' ? 'fit' : String(zoom)}
              onChange={(e) => {
                const v = e.target.value;
                setZoom(v === 'fit' ? 'fit' : (Number(v) as PdfViewerZoom));
              }}
              className="max-w-[7rem] cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600"
              title="Nivel de zoom"
            >
              <option value="fit">Ajustar ancho</option>
              {PDF_VIEWER_ZOOM_SCALES.map((s) => (
                <option key={s} value={s}>
                  {Math.round(s * 100)}%
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Acercar"
              onClick={() => setZoom((z) => stepPdfZoom(z, 1))}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-accent"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <span className="hidden text-[9px] text-slate-400 sm:inline">{pdfZoomLabel(zoom)}</span>
          </div>
        </div>

        {signedUrl ? (
          <a 
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold text-accent hover:underline flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg"
          >
            <ExternalLink className="w-3 h-3" /> ABRIR ADJUNTO (STORAGE)
          </a>
        ) : content ? (
          <a 
            href={`data:${contentType || 'application/pdf'};base64,${content}`} 
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

export type CaseExpedienteDigitalPanelProps = {
  caseId: string;
  caseItem: Case;
  docs: CaseDoc[];
  docsLoaded: boolean;
  selectedDoc: CaseDoc | null;
  onSelectDoc: (doc: CaseDoc | null) => void;
  onRefetchCase: () => void | Promise<void>;
  onRefetchDocs: () => void | Promise<void>;
};


export function CaseExpedienteDigitalPanel({
  caseId,
  caseItem,
  docs,
  docsLoaded,
  selectedDoc,
  onSelectDoc,
  onRefetchCase,
  onRefetchDocs,
}: CaseExpedienteDigitalPanelProps) {
  const [constanciaAbierta, setConstanciaAbierta] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [aiTrigger, setAiTrigger] = useState(0);
  const autoAbrirVisorRef = useRef(false);
  const visorPieza = Boolean(selectedDoc && isCaseDocumentOpenableInViewer(selectedDoc));
  const panelDerechoAbierto = visorPieza || constanciaAbierta;

  useEffect(() => {
    autoAbrirVisorRef.current = false;
  }, [caseId]);

  useEffect(() => {
    if (!docsLoaded || autoAbrirVisorRef.current) return;
    const first = primeraPiezaParaAbrir(docs);
    if (!first) return;
    autoAbrirVisorRef.current = true;
    if (!visorPieza) {
      setConstanciaAbierta(false);
      onSelectDoc(first);
    }
  }, [docsLoaded, docs, visorPieza, onSelectDoc]);

  const cerrarPanelDerecho = () => {
    setConstanciaAbierta(false);
    onSelectDoc(null);
  };

  const seleccionarPieza = (doc: CaseDoc | null) => {
    setConstanciaAbierta(false);
    setPdfPageCount(null);
    onSelectDoc(doc);
  };

  const lecturaRapidaPieza = (doc: CaseDoc) => {
    setConstanciaAbierta(false);
    onSelectDoc(doc);
    setAiTrigger((t) => t + 1);
  };

  const splitHostRef = useRef<HTMLDivElement>(null);
  const dragSplitRef = useRef(false);
  const [listaRatio, setListaRatio] = useState(0.44);
  const SPLIT_MIN_LISTA_PX = 280;
  const SPLIT_MIN_VISOR_PX = 320;

  useEffect(() => {
    setListaRatio(0.44);
  }, [caseId]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragSplitRef.current || !splitHostRef.current) return;
      const rect = splitHostRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const minR = SPLIT_MIN_LISTA_PX / rect.width;
      const maxR = (rect.width - SPLIT_MIN_VISOR_PX) / rect.width;
      const r = (e.clientX - rect.left) / rect.width;
      setListaRatio(Math.min(maxR, Math.max(minR, r)));
    };
    const onUp = () => {
      if (!dragSplitRef.current) return;
      dragSplitRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const iniciarArrastreSeparador = () => {
    dragSplitRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const refetchCaseAndDocs = async () => {
    await onRefetchCase();
    await onRefetchDocs();
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div
        ref={splitHostRef}
        className={`flex w-full min-w-0 flex-col gap-4 xl:h-[clamp(32rem,82vh,54rem)] ${
          panelDerechoAbierto ? 'xl:flex-row xl:gap-0' : ''
        }`}
      >
            <div
              className={`card-modern flex min-h-0 min-w-0 flex-col overflow-hidden p-4 md:p-5 xl:h-full ${
                panelDerechoAbierto
                  ? 'min-h-[min(70vh,40rem)] shrink-0 rounded-r-none border-r-0'
                  : 'mx-auto min-h-[min(70vh,40rem)] w-full xl:max-w-4xl'
              }`}
              style={panelDerechoAbierto ? { width: `${Math.round(listaRatio * 1000) / 10}%` } : undefined}
            >
            {!docsLoaded ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-xs font-medium">Cargando documentos del expediente…</span>
              </div>
            ) : (
              <ExpedienteDigitalPanel
                caseId={caseId}
                caseItem={caseItem}
                extraNotebooks={caseItem.expedienteCuadernosExtra ?? []}
                onRefetchCase={onRefetchCase}
                docs={docs}
                selectedDoc={selectedDoc}
                onSelectDoc={seleccionarPieza}
                onRefetchDocs={onRefetchDocs}
                visorAbierto={panelDerechoAbierto}
                onVerConstanciaIngreso={() => {
                  onSelectDoc(null);
                  setConstanciaAbierta(true);
                }}
                pdfPageCount={pdfPageCount}
                onLecturaRapidaPieza={lecturaRapidaPieza}
              />
            )}
            </div>

            {panelDerechoAbierto ? (
            <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Ajustar ancho entre lista y visor"
              title="Arrastre para cambiar el tamaño"
              onMouseDown={iniciarArrastreSeparador}
              className="relative z-10 hidden shrink-0 cursor-col-resize bg-slate-200/90 hover:bg-accent/25 active:bg-accent/35 xl:flex xl:w-2 xl:flex-col xl:items-center xl:justify-center"
            >
              <div className="pointer-events-none flex h-12 w-1 flex-col items-center justify-center gap-0.5 rounded-full bg-white/90 shadow-sm ring-1 ring-slate-300/80">
                <span className="block h-1 w-1 rounded-full bg-slate-400" />
                <span className="block h-1 w-1 rounded-full bg-slate-400" />
                <span className="block h-1 w-1 rounded-full bg-slate-400" />
              </div>
            </div>
            <div className="card-modern flex h-[min(52vh,32rem)] min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-l-none xl:h-full">
            <div className="flex shrink-0 flex-col gap-1 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                  <FileText className="h-4 w-4 shrink-0 text-accent" />
                  {visorPieza && selectedDoc
                    ? `Visor: ${sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(selectedDoc))}`
                    : 'Constancia de ingreso (correo)'}
                </h3>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Cierre el visor para ampliar la lista de piezas (estilo explorador de archivos).
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarPanelDerecho}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:border-accent/40 hover:text-accent"
              >
                Cerrar visor
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {visorPieza && selectedDoc ? (
                <>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5">
                {isCaseDocumentDocx(selectedDoc) ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-2 sm:p-3">
                  <ExpedienteDocxPreview
                    key={selectedDoc.id}
                    storagePath={selectedDoc.storagePath}
                    filename={sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(selectedDoc))}
                    onBack={cerrarPanelDerecho}
                  />
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <PdfViewer
                    key={selectedDoc.id}
                    content={selectedDoc.content}
                    contentType={selectedDoc.contentType}
                    filename={sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(selectedDoc))}
                    ingestError={selectedDoc.ingestError}
                    storagePath={selectedDoc.storagePath}
                    onBack={cerrarPanelDerecho}
                    onPageCountChange={
                      isCaseDocumentPdf(selectedDoc) ? setPdfPageCount : undefined
                    }
                  />
                </div>
              )}
                </div>
                <ExpedientePieceAiPanel
                  caseId={caseId}
                  doc={selectedDoc}
                  pdfPageCount={isCaseDocumentPdf(selectedDoc) ? pdfPageCount : null}
                  refreshToken={aiTrigger}
                  onAnalyzed={onRefetchDocs}
                />
                </>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  {caseItem.emailMetadata ? (
                    <details className="shrink-0 border-b border-slate-200 bg-slate-50/90 text-[10px] text-slate-600">
                      <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-500 hover:bg-slate-100/80">
                        Metadatos del correo — pulse para desplegar
                      </summary>
                      <div className="space-y-1.5 border-t border-slate-100 px-3 py-2 leading-snug break-words">
                        <p>
                          <span className="font-bold text-slate-400">De</span>{' '}
                          {String(caseItem.emailMetadata.from ?? '')}
                        </p>
                        <p>
                          <span className="font-bold text-slate-400">Para</span>{' '}
                          {String(caseItem.emailMetadata.to || 'Despacho judicial')}
                        </p>
                        <p>
                          <span className="font-bold text-slate-400">Asunto</span>{' '}
                          <span className="font-medium text-slate-800">
                            {String(caseItem.emailMetadata.subject ?? '')}
                          </span>
                        </p>
                      </div>
                    </details>
                  ) : null}
                  <div className="min-h-0 flex-1 overflow-auto bg-white">
                    {caseItem.rawHtml ? (
                      <iframe
                        srcDoc={`<html><head><style>body{font-family:system-ui,sans-serif;line-height:1.5;color:#334155;padding:20px}img{max-width:100%}</style></head><body>${caseItem.rawHtml}</body></html>`}
                        className="h-full min-h-[12rem] w-full border-none"
                        title="Constancia de ingreso"
                      />
                    ) : (
                      <div className="p-6 text-sm leading-relaxed whitespace-pre-wrap text-slate-500">
                        {caseItem.rawText || 'No hay contenido disponible.'}
                      </div>
                    )}
                  </div>
                </div>
                </div>
              )}
            </div>
          </div>
            </>
            ) : null}
      </div>

      {docsLoaded ? (
        <div className="w-full shrink-0">
          <ExpedienteSgdeBar
            caseId={caseId}
            caseItem={caseItem}
            docs={docs}
            onRefetchCase={refetchCaseAndDocs}
          />
        </div>
      ) : null}
    </div>
  );
}
