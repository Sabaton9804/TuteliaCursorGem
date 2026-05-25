import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { FileText, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
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
import { ExpedienteDocxPreview } from './ExpedienteDocxPreview';
import { isCaseDocumentDocx } from '../../lib/expediente-docx';
import type { Case, Document as CaseDoc } from '../../types';
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

const PDF_VIEWER_ZOOM_SCALES = [0.5, 0.75, 1.0, 1.25, 1.5] as const;
type PdfViewerZoom = 'fit' | (typeof PDF_VIEWER_ZOOM_SCALES)[number];

function PdfViewer({
  content,
  contentType,
  filename,
  onBack,
  ingestError,
  storagePath,
}: {
  content?: string;
  contentType?: string;
  filename: string;
  onBack?: () => void;
  ingestError?: string;
  /** Ruta en bucket `case-documents` (columna `storage_path`). */
  storagePath?: string;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
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
    setPageNumber(1);
    setZoom('fit');
  }, [content, storagePath]);

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
    setPageNumber(1);
  }

  if (!hasStorage && !hasContent) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center space-y-6 flex-1 min-h-[600px] max-w-lg mx-auto">
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
      <div className="p-10 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-[600px] max-w-lg mx-auto">
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
      <div className="p-12 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-[600px]">
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
      <div className="p-10 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-[600px] max-w-lg mx-auto">
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
      <div className="flex-1 overflow-auto bg-slate-200 p-8 flex items-center justify-center min-h-[600px]">
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
      <div className="p-10 flex flex-col items-center justify-center text-center space-y-4 flex-1 min-h-[600px] max-w-lg mx-auto">
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
    <div className="flex-1 flex flex-col h-full bg-slate-100 min-h-[600px] overflow-hidden min-w-0">
      <div
        ref={viewportRef}
        className="flex-1 overflow-auto p-4 flex justify-center min-w-0"
      >
        <div className="shadow-2xl max-w-full">
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
            <Page
              pageNumber={pageNumber}
              width={pageWidthProp}
              scale={pageScaleProp}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="max-w-full"
            />
          </Document>
        </div>
      </div>

      <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber(prev => prev - 1)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-accent hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest w-24 text-center">
              PÁGINA {pageNumber} / {numPages || '?'}
            </span>
            <button
              disabled={numPages === null || pageNumber >= numPages}
              onClick={() => setPageNumber(prev => prev + 1)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-accent hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="h-4 w-px bg-slate-200 mx-2" />
          
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
  return (
          <div className="flex w-full min-w-0 flex-col gap-6 xl:flex-row xl:items-stretch">
            <div className="card-modern w-full min-w-0 overflow-hidden p-6 md:p-8 xl:max-w-[min(100%,480px)] xl:shrink-0">
            {!docsLoaded ? (
              <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
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
                onSelectDoc={onSelectDoc}
                onRefetchDocs={onRefetchDocs}
              />
            )}
            </div>

            {/* Constancia de ingreso / visor de piezas — panel lateral en escritorio */}
            <div className="card-modern flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" />
                {selectedDoc && selectedDoc.name !== 'CorreoReparto'
                  ? `Visor: ${sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(selectedDoc))}`
                  : 'Constancia de ingreso (cuerpo del correo)'}
              </h3>
              {selectedDoc && (
                <button 
                  onClick={() => onSelectDoc(null)}
                  className="text-[10px] font-bold text-slate-400 hover:text-accent uppercase tracking-widest"
                >
                  Cerrar Visor
                </button>
              )}
            </div>
            <div className="p-8">
              {!selectedDoc || selectedDoc.name === 'CorreoReparto' ? (
                <div className="bg-white border border-slate-200 shadow-sm rounded-lg overflow-hidden">
                  {caseItem && caseItem.emailMetadata && (
                    <details className="border-b border-slate-200 bg-slate-50/90 text-[10px] text-slate-600">
                      <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-500 hover:bg-slate-100/80">
                        Metadatos del correo (De / Para / Asunto) — pulse para desplegar
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
                          <span className="font-medium text-slate-800">{String(caseItem.emailMetadata.subject ?? '')}</span>
                        </p>
                        {caseItem.emailMetadata.linkFound ? (
                          <p className="text-sky-700 break-all">{String(caseItem.emailMetadata.linkUrl ?? '')}</p>
                        ) : null}
                      </div>
                    </details>
                  )}

                  <div className="p-0 max-h-[700px] bg-white">
                    {caseItem.rawHtml ? (
                      <iframe 
                        srcDoc={`
                          <html>
                            <head>
                              <style>
                                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #334155; padding: 20px; }
                                img { max-width: 100%; height: auto; }
                              </style>
                            </head>
                            <body>${caseItem.rawHtml}</body>
                          </html>
                        `}
                        className="w-full min-h-[600px] border-none"
                        title="Email Body Detailed"
                      />
                    ) : (
                      <div className="p-10 font-sans text-sm leading-relaxed text-slate-500 whitespace-pre-wrap">
                        {caseItem.rawText || 'No hay contenido disponible.'}
                      </div>
                    )}
                  </div>
                </div>
              ) : isCaseDocumentDocx(selectedDoc) ? (
                <div className="flex min-h-[600px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 p-3 sm:p-4">
                  <ExpedienteDocxPreview
                    key={selectedDoc.id}
                    storagePath={selectedDoc.storagePath}
                    filename={sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(selectedDoc))}
                    onBack={() => onSelectDoc(null)}
                  />
                </div>
              ) : (
                <div className="flex min-h-[600px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
                  <PdfViewer
                    key={selectedDoc.id}
                    content={selectedDoc.content}
                    contentType={selectedDoc.contentType}
                    filename={sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(selectedDoc))}
                    ingestError={selectedDoc.ingestError}
                    storagePath={selectedDoc.storagePath}
                    onBack={() => onSelectDoc(null)}
                  />
                </div>
              )}
            </div>
          </div>
          </div>
  );
}
