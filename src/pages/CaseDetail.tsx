import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { rowToAction, rowToCase, rowToCaseDoc } from '../lib/supabase-mappers';
import { Action, Case, Document as CaseDoc } from '../types';
import { 
  FileText, 
  History,
  Sparkles,
  ChevronDown,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Scale,
  UserCog,
} from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { summarizeCase } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { Document, Page } from 'react-pdf';
import { formatRadicado } from '../lib/formatters';
import { looksLikePdf } from '../lib/pdf-sniff';
import { logPdfViewerDebug } from '../lib/pdf-payload-debug';
import {
  CASE_DOCUMENTS_BUCKET,
  CASE_DOCUMENT_SIGNED_URL_TTL_SEC,
} from '../lib/case-document-storage';
import { sanitizeExpedienteFilenameForDisplay } from '../lib/sanitize-expediente-filename';
import { ExpedienteDigitalPanel } from '../components/expediente/ExpedienteDigitalPanel';
import { buildCaseTimeline, buildSynthesisContextBlock } from '../lib/case-detail-context';
import { resolveAssigneeForCase, SUSTANCIADORES } from '../lib/court-staff-assignees';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

type ExpedienteTab = 'sintesis' | 'expediente' | 'actuaciones';

const TAB_QUERY_VALUES = new Set<string>(['sintesis', 'expediente', 'actuaciones']);

const CASE_STATUS_LABEL: Record<string, string> = {
  received: 'Recibido',
  admitted: 'Admitido',
  transfer: 'Traslado',
  judgment: 'Fallo',
  archived: 'Archivado',
};

function parseExpedienteTabParam(raw: string | null): ExpedienteTab {
  if (raw === 'expediente' || raw === 'actuaciones') return raw;
  return 'sintesis';
}

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
  const [scale, setScale] = useState(1.0);
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
  }, [content, storagePath]);

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

  const documentFile = signedUrl || pdfBlob;

  if (!documentFile) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-200" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 min-h-[600px] overflow-hidden">
      <div className="flex-1 overflow-auto p-4 flex justify-center">
        <div className="shadow-2xl">
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
              scale={scale} 
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
            value={scale} 
            onChange={(e) => setScale(Number(e.target.value))}
            className="text-[10px] font-bold text-slate-500 uppercase bg-transparent border-none focus:ring-0 cursor-pointer"
          >
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1.0}>100%</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
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

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [docs, setDocs] = useState<CaseDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<CaseDoc | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Evita mostrar «sincronizando» cuando en realidad no hay filas en `case_documents`. */
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [assignDraft, setAssignDraft] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [newActionText, setNewActionText] = useState('');
  const [manualActSaving, setManualActSaving] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const timeline = useMemo(
    () => (caseItem ? buildCaseTimeline(caseItem, docs, actions) : []),
    [caseItem, docs, actions],
  );

  const resolvedAssignee = useMemo(() => {
    if (!caseItem) return null;
    return resolveAssigneeForCase(caseItem.assignedTo, caseItem.id);
  }, [caseItem]);

  const activeTab = useMemo(
    () => parseExpedienteTabParam(searchParams.get('tab')),
    [searchParams],
  );

  const setActiveTab = useCallback(
    (tab: ExpedienteTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    const raw = searchParams.get('tab');
    if (raw != null && !TAB_QUERY_VALUES.has(raw)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', 'sintesis');
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (caseItem) setAssignDraft(caseItem.assignedTo?.trim() ?? '');
  }, [caseItem?.assignedTo, caseItem?.id]);

  const refetchDocs = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('case_documents')
        .select('*')
        .eq('case_id', id)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setDocs((data ?? []).map((r) => rowToCaseDoc(r as Record<string, unknown>, id)) as CaseDoc[]);
    } catch (e) {
      console.error('case_documents:', e);
      setDocs([]);
    } finally {
      setDocsLoaded(true);
    }
  }, [id]);

  const refetchCase = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.from('cases').select('*').eq('id', id).maybeSingle();
    if (data && !error) setCaseItem(rowToCase(data as Record<string, unknown>));
  }, [id]);

  const refetchActions = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('case_actions')
        .select('*')
        .eq('case_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setActions((data ?? []).map((r) => rowToAction(r as Record<string, unknown>)));
    } catch (e) {
      console.error('case_actions:', e);
      setActions([]);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setDocsLoaded(false);
    setDocs([]);

    async function loadCase() {
      const { data, error } = await supabase.from('cases').select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      if (data && !error) setCaseItem(rowToCase(data as Record<string, unknown>));
      setLoading(false);
    }

    void loadCase();
    void refetchDocs();
    void refetchActions();

    const channel = supabase
      .channel(`case-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases', filter: `id=eq.${id}` }, () => {
        void loadCase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_documents', filter: `case_id=eq.${id}` }, () => {
        void refetchDocs();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_actions', filter: `case_id=eq.${id}` }, () => {
        void refetchActions();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [id, refetchDocs, refetchActions]);

  const handleApplyAssign = useCallback(async () => {
    if (!id || !caseItem) return;
    const next = assignDraft.trim();
    const prev = (caseItem.assignedTo || '').trim();
    if (next === prev) return;
    setAssignSaving(true);
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('cases')
        .update({ assigned_to: next.length > 0 ? next : null, updated_at: now })
        .eq('id', id);
      if (upErr) throw upErr;

      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      await supabase.from('case_actions').insert({
        case_id: id,
        type: 'assignment',
        description: next
          ? `Sustanciador asignado: ${next}`
          : 'Sustanciador desasignado — reparto automático del despacho',
        user_id: u.user?.id ?? null,
        user_name: String(uname),
      });
      await refetchCase();
      await refetchActions();
    } catch (err) {
      console.error(err);
    } finally {
      setAssignSaving(false);
    }
  }, [id, caseItem, assignDraft, refetchCase, refetchActions]);

  const handleRegisterManualAction = useCallback(async () => {
    if (!id || !caseItem) return;
    const text = newActionText.trim();
    if (!text) return;
    setManualActSaving(true);
    try {
      await ensureSupabaseSessionForWrites();
      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      await supabase.from('case_actions').insert({
        case_id: id,
        type: 'manual_entry',
        description: text,
        user_id: u.user?.id ?? null,
        user_name: String(uname),
      });
      setNewActionText('');
      await refetchActions();
    } catch (err) {
      console.error(err);
    } finally {
      setManualActSaving(false);
    }
  }, [id, caseItem, newActionText, refetchActions]);

  const handleSummarize = async () => {
    if (!caseItem || !id) return;
    setIsSummarizing(true);
    try {
      await ensureSupabaseSessionForWrites();
      const contextBlock = buildSynthesisContextBlock(caseItem, docs);
      const summary = await summarizeCase(caseItem.claimant, caseItem.rawText || '', contextBlock);
      const now = new Date().toISOString();
      await supabase.from('cases').update({ summary, updated_at: now }).eq('id', id);

      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      await supabase.from('case_actions').insert({
        case_id: id,
        type: 'ai_synthesis',
        description: 'Generación de síntesis procesal por IA',
        user_id: u.user?.id ?? null,
        user_name: String(uname),
      });
      await refetchCase();
      await refetchActions();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!id || !caseItem) return;
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('cases')
        .update({ status: newStatus, updated_at: now })
        .eq('id', id);
      if (upErr) throw upErr;

      const { data: u } = await supabase.auth.getUser();
      const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
      const { error: insErr } = await supabase.from('case_actions').insert({
        case_id: id,
        type: 'status_change',
        description: `Cambio de estado a ${newStatus.toUpperCase()}`,
        user_id: u.user?.id ?? null,
        user_name: String(uname),
      });
      if (insErr) throw insErr;
      await refetchCase();
      await refetchActions();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-10 text-center font-mono">CARGANDO...</div>;
  if (!caseItem) return <div className="p-10 text-center font-mono">EXPEDIENTE NO ENCONTRADO</div>;

  return (
    <div className="w-full min-w-0 space-y-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => navigate('/')} 
            className="w-12 h-12 flex items-center justify-center bg-white border border-slate-100 rounded-2xl hover:bg-slate-50 transition-all text-slate-400 hover:text-accent shadow-sm"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Expediente {formatRadicado(caseItem.radicado)}</h1>
              <span className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-widest border ${
                caseItem.status === 'received' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                caseItem.status === 'admitted' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
                {caseItem.status}
              </span>
            </div>
            <p className="text-sm font-medium text-slate-500 mt-1">
              Referencia SGDE: <span className="text-emerald-600 font-bold">CERTIFICADA-2026-0045</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleSummarize}
            disabled={isSummarizing}
            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
          >
            {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-accent" />}
            {caseItem.summary ? 'Refinar Análisis' : 'Analizar con IA'}
          </button>
          
          <div className="relative group">
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none transition-transform group-hover:translate-y-[-40%]" />
            <select 
              className="input-modern py-3 pl-6 pr-12 text-xs font-bold uppercase cursor-pointer appearance-none bg-white min-w-[220px]"
              value={caseItem.status}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              <option value="received">Recibido</option>
              <option value="admitted">Admitir</option>
              <option value="transfer">Traslado</option>
              <option value="judgment">Fallo</option>
              <option value="archived">Archivar</option>
            </select>
          </div>
        </div>
      </header>

      {resolvedAssignee ? (
        <div className="flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <UserCog className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sustanciador</span>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${resolvedAssignee.bg} ${resolvedAssignee.text} ring-1 ${resolvedAssignee.ring}`}
            >
              {resolvedAssignee.initials}
            </span>
            <span className="min-w-0 text-sm font-semibold text-slate-800">
              {caseItem.assignedTo?.trim()
                ? caseItem.assignedTo.trim()
                : `${resolvedAssignee.name} (reparto automático)`}
            </span>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <select
              className="input-modern min-h-[44px] w-full min-w-0 text-xs font-medium sm:min-w-[240px] sm:max-w-[320px]"
              value={assignDraft}
              onChange={(e) => setAssignDraft(e.target.value)}
              aria-label="Elegir sustanciador asignado"
            >
              <option value="">Reparto automático (sin asignar)</option>
              {SUSTANCIADORES.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.initials} — {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleApplyAssign()}
              disabled={
                assignSaving ||
                assignDraft.trim() === (caseItem.assignedTo || '').trim()
              }
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {assignSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar asignación
            </button>
          </div>
        </div>
      ) : null}

      <nav
        className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
        aria-label="Secciones del expediente"
      >
        <div className="flex min-w-0 gap-0 overflow-x-auto px-1 sm:gap-2 sm:px-4" role="tablist">
          <button
            type="button"
            role="tab"
            id="tab-sintesis"
            aria-selected={activeTab === 'sintesis'}
            aria-controls="panel-sintesis"
            onClick={() => setActiveTab('sintesis')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'sintesis'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Síntesis cognitiva
          </button>
          <button
            type="button"
            role="tab"
            id="tab-expediente"
            aria-selected={activeTab === 'expediente'}
            aria-controls="panel-expediente"
            onClick={() => setActiveTab('expediente')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'expediente'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Expediente digital
          </button>
          <button
            type="button"
            role="tab"
            id="tab-actuaciones"
            aria-selected={activeTab === 'actuaciones'}
            aria-controls="panel-actuaciones"
            onClick={() => setActiveTab('actuaciones')}
            className={`shrink-0 border-b-2 px-3 py-3.5 text-[11px] font-bold uppercase tracking-widest transition-colors sm:px-5 ${
              activeTab === 'actuaciones'
                ? 'border-accent text-accent'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Actuaciones
          </button>
        </div>
      </nav>

      <div className="w-full min-w-0">
        <div
          id="panel-sintesis"
          role="tabpanel"
          aria-labelledby="tab-sintesis"
          className={activeTab === 'sintesis' ? 'block' : 'hidden'}
        >
          {/* Summary / AI Card — partes + hechos + pretensiones + derecho en un solo cuadro */}
          <div className="card-modern w-full min-w-0 overflow-hidden shadow-sm transition-all hover:shadow-lg">
            <div className="bg-white px-6 sm:px-8 py-3.5 border-b border-slate-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                Síntesis cognitiva judicial
              </div>
              <div className="flex flex-col sm:items-end gap-1">
                <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400 normal-case">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  GPT-4o optimizado
                </div>
                <p className="hidden sm:block text-[9px] text-slate-500 font-medium normal-case tracking-normal text-right max-w-[240px] leading-snug">
                  Documentos y constancia de ingreso en la pestaña Expediente digital. La IA usa plazos y piezas del expediente al generar la síntesis.
                </p>
              </div>
            </div>

            <div className="border-b border-slate-100 bg-slate-50/90 px-6 py-4 sm:px-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Contexto procesal (vista despacho)</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                <li>
                  <span className="font-semibold text-slate-600">Estado judicial: </span>
                  {CASE_STATUS_LABEL[caseItem.status] ?? caseItem.status}
                </li>
                <li>
                  <span className="font-semibold text-slate-600">Estado operativo: </span>
                  {caseItem.operationalStatus?.trim() || 'Sin dato en expediente'}
                </li>
                <li>
                  <span className="font-semibold text-slate-600">Plazo / término en sistema: </span>
                  {caseItem.deadlineAt && isValid(parseISO(caseItem.deadlineAt))
                    ? format(parseISO(caseItem.deadlineAt), "EEEE d 'de' MMMM yyyy", { locale: es })
                    : 'No registrado — complételo en el tablero o actuaciones si aplica'}
                </li>
                <li>
                  <span className="font-semibold text-slate-600">Piezas en expediente digital: </span>
                  {docs.length === 0 ? 'Ninguna aún' : `${docs.length} (se envían títulos a la IA al analizar)`}
                </li>
              </ul>
            </div>

            <div className="bg-white">
              <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
                <div className="min-w-0 px-6 py-6 sm:px-8 sm:py-7 space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Accionante</p>
                  <p className="text-[15px] font-bold text-slate-800 leading-snug tracking-tight">{caseItem.claimant}</p>
                  <div className="flex flex-wrap gap-2">
                    {caseItem.claimantId ? (
                      <span className="inline-flex rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        {caseItem.claimantId}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-1 text-[10px] font-medium text-slate-400">
                        Identificación no disponible
                      </span>
                    )}
                  </div>
                  {caseItem.claimantEmail ? (
                    <p className="text-xs font-medium text-sky-700/90 truncate" title={caseItem.claimantEmail}>
                      {caseItem.claimantEmail}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0 px-6 py-6 sm:px-8 sm:py-7 space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Accionado</p>
                  <p className="text-[15px] font-bold text-slate-800 leading-snug tracking-tight">{caseItem.defendant}</p>
                  <div className="flex flex-wrap gap-2">
                    {caseItem.defendantId ? (
                      <span className="inline-flex rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        {caseItem.defendantId}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-1 text-[10px] font-medium text-slate-400">
                        Identificación no disponible
                      </span>
                    )}
                  </div>
                  {caseItem.defendantEmail ? (
                    <p className="text-xs font-medium text-sky-700/90 truncate" title={caseItem.defendantEmail}>
                      {caseItem.defendantEmail}
                    </p>
                  ) : null}
                </div>
              </div>

              {caseItem.legalHechos || caseItem.legalPretensiones || caseItem.legalDerechoTutelado ? (
                <>
                  <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 animate-in fade-in duration-500">
                    <div className="min-w-0 px-6 py-6 sm:px-8 sm:py-7 space-y-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Hechos relevantes</p>
                      <p className="text-sm leading-relaxed text-slate-700">
                        {caseItem.legalHechos || 'Sin datos de hechos específicos.'}
                      </p>
                    </div>
                    <div className="min-w-0 px-6 py-6 sm:px-8 sm:py-7 space-y-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Pretensiones</p>
                      <div className="rounded-xl border border-emerald-100/80 bg-emerald-50/90 px-4 py-3.5">
                        <p className="text-sm font-medium leading-relaxed text-emerald-900">
                          {caseItem.legalPretensiones || 'Sin pretensiones identificadas.'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/40 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Derecho tutelado</span>
                    <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-left text-xs font-semibold text-sky-900 sm:text-right">
                      <Scale className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
                      <span className="leading-snug">{caseItem.legalDerechoTutelado || 'No especificado'}</span>
                    </div>
                  </div>
                </>
              ) : null}

              <div className="space-y-8 px-6 py-8 sm:px-8">
              {caseItem.summary ? (
                <div className="prose prose-slate prose-sm max-w-none prose-headings:text-slate-900 prose-strong:text-accent font-sans leading-relaxed text-slate-600">
                  <ReactMarkdown>{caseItem.summary}</ReactMarkdown>
                </div>
              ) : !caseItem.legalHechos ? (
                <div className="py-20 border-2 border-dashed border-slate-100 rounded-3xl text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
                    <Sparkles className="w-8 h-8 text-accent animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-700">Sin síntesis procesal</h3>
                    <p className="text-sm text-slate-400 font-medium max-w-xs mx-auto mt-2">Active el asistente de IA para extraer hechos relevantes y pretensiones jurídicas.</p>
                  </div>
                  <button 
                    onClick={handleSummarize} 
                    className="btn-primary px-10 py-3 text-xs"
                  >
                    IDENTIFICAR HECHOS Y PRETENSIÓN
                  </button>
                </div>
              ) : (
                <div className="pt-4 flex flex-col items-center gap-3 max-w-xl mx-auto text-center">
                  <button
                    type="button"
                    onClick={handleSummarize}
                    disabled={isSummarizing}
                    title="Llama a la IA con el accionante y el texto del expediente para producir un informe en markdown y guardarlo en el campo síntesis del caso."
                    className="text-[10px] font-bold text-accent uppercase tracking-widest bg-blue-50 px-4 py-2.5 rounded-lg border border-blue-100 hover:bg-blue-100/80 flex items-center gap-2 disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3" /> Generar síntesis operativa completa
                  </button>
                  <p className="text-[11px] text-slate-500 leading-relaxed px-2">
                    Construye el texto de <span className="font-semibold text-slate-600">síntesis procesal</span> (markdown)
                    a partir del accionante y del cuerpo del correo o expediente; no reemplaza hechos ni pretensiones ya
                    guardados.
                  </p>
                </div>
              )}

              <div className="sm:hidden flex flex-wrap justify-center border-t border-slate-100 pt-6">
                <button
                  type="button"
                  onClick={() => setActiveTab('expediente')}
                  className="text-[10px] font-bold text-accent uppercase tracking-widest hover:underline"
                >
                  Ir a expediente digital ({docs.length} documentos)
                </button>
              </div>
              </div>
            </div>
          </div>
        </div>

        <div
          id="panel-expediente"
          role="tabpanel"
          aria-labelledby="tab-expediente"
          className={activeTab === 'expediente' ? 'block' : 'hidden'}
        >
          <div className="flex w-full min-w-0 flex-col gap-6 xl:flex-row xl:items-stretch">
            <div className="card-modern w-full min-w-0 overflow-hidden p-6 md:p-8 xl:max-w-[min(100%,480px)] xl:shrink-0">
            {!docsLoaded ? (
              <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-xs font-medium">Cargando documentos del expediente…</span>
              </div>
            ) : (
              <ExpedienteDigitalPanel
                caseId={id!}
                extraNotebooks={caseItem.expedienteCuadernosExtra ?? []}
                onRefetchCase={refetchCase}
                docs={docs}
                selectedDoc={selectedDoc}
                onSelectDoc={setSelectedDoc}
                onRefetchDocs={refetchDocs}
              />
            )}
            </div>

            {/* Constancia de ingreso / visor de piezas — panel lateral en escritorio */}
            <div className="card-modern flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" />
                {selectedDoc && selectedDoc.name !== 'CorreoReparto'
                  ? `Visor: ${sanitizeExpedienteFilenameForDisplay(
                      (selectedDoc.originalName?.trim() || selectedDoc.name).trim()
                    )}`
                  : 'Constancia de ingreso (cuerpo del correo)'}
              </h3>
              {selectedDoc && (
                <button 
                  onClick={() => setSelectedDoc(null)}
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
              ) : (
                <div className="bg-slate-100 rounded-3xl overflow-hidden min-h-[600px] flex flex-col border border-slate-200">
                   <PdfViewer
                     key={selectedDoc.id}
                     content={selectedDoc.content} 
                     contentType={selectedDoc.contentType} 
                     filename={sanitizeExpedienteFilenameForDisplay(
                       (selectedDoc.originalName?.trim() || selectedDoc.name).trim()
                     )}
                     ingestError={selectedDoc.ingestError}
                     storagePath={selectedDoc.storagePath}
                     onBack={() => setSelectedDoc(null)}
                   />
                </div>
              )}
            </div>
          </div>
          </div>
        </div>

        <div
          id="panel-actuaciones"
          role="tabpanel"
          aria-labelledby="tab-actuaciones"
          className={activeTab === 'actuaciones' ? 'block' : 'hidden'}
        >
          <div id="panel-trazabilidad" className="card-modern flex w-full min-w-0 flex-col p-6 scroll-mt-24 sm:p-8">
            <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                <History className="h-4 w-4 text-accent" aria-hidden /> Trazabilidad operativa
              </h3>
              <p className="max-w-xl text-[11px] leading-snug text-slate-500">
                Línea de tiempo del expediente: ingreso, plazos, piezas y lo que registre el despacho. Use el formulario
                para anotar traslados, términos para contestar o acuerdos.
              </p>
            </div>

            <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
              <label htmlFor="manual-actuacion" className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Registrar actuación
              </label>
              <textarea
                id="manual-actuacion"
                value={newActionText}
                onChange={(e) => setNewActionText(e.target.value)}
                rows={3}
                placeholder="Ej.: Traslado a la EPS para contestación; término de 2 días hábiles; constancia en SGDE…"
                className="input-modern mt-2 w-full resize-y text-sm"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleRegisterManualAction()}
                  disabled={!newActionText.trim() || manualActSaving}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {manualActSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Guardar en trazabilidad
                </button>
                <span className="text-[10px] text-slate-400">Queda en la tabla «case_actions» y en esta lista.</span>
              </div>
            </div>

            <div className="scrollbar-thin max-h-[min(72vh,640px)] space-y-6 overflow-y-auto pr-1 sm:pr-2">
              {timeline.map((row) => {
                const dotClass =
                  row.kind === 'document'
                    ? 'bg-sky-500'
                    : row.kind === 'action'
                      ? 'bg-slate-500'
                      : 'bg-emerald-500';
                const atLabel =
                  row.at && !Number.isNaN(Date.parse(row.at))
                    ? format(new Date(row.at), 'dd MMM yyyy · HH:mm', { locale: es })
                    : '';
                return (
                  <div key={row.key} className="relative border-l border-slate-200 pb-1 pl-8 last:pb-0">
                    <div
                      className={`absolute left-[-5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm ${dotClass}`}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{atLabel}</p>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                          row.kind === 'document'
                            ? 'bg-sky-50 text-sky-800'
                            : row.kind === 'action'
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {row.kind === 'document' ? 'Pieza' : row.kind === 'action' ? 'Registro' : 'Sistema'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-bold leading-snug text-slate-800">{row.title}</p>
                    {row.subtitle ? (
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{row.subtitle}</p>
                    ) : null}
                    {row.actor ? (
                      <div className="mt-2 flex items-center gap-1.5 opacity-70">
                        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">
                          {row.actor[0]}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {row.actor}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
