import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ArrowRight, 
  ExternalLink, 
  ChevronLeft, 
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Edit2,
  Combine,
  X,
  Check,
  Sparkles,
  Search
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import { getSupabaseAuthErrorMessage } from '../lib/supabase-auth-errors';
import { handleDataPermissionError } from '../lib/error-handler';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Page } from 'react-pdf';
import { PDFDocument } from 'pdf-lib';
import { COURT_CONSTANTS, RIGHTS_LIST } from '../constants';
import { formatRadicado } from '../lib/formatters';
import {
  base64ToUint8Array,
  insertCaseDocumentRows,
  removeCaseDocumentObjects,
  uploadCaseAttachment,
} from '../lib/case-document-storage';
import { looksLikePdf } from '../lib/pdf-sniff';
import { DEFAULT_NOTEBOOK_CODE } from '../lib/expediente-notebook';
import { logPdfViewerDebug } from '../lib/pdf-payload-debug';
import { fetchParseSessionAttachment, uint8ArrayToBase64 } from '../lib/parse-session-attachment';
import { NEW_CASE_FRESH_EVENT, NEW_CASE_FRESH_NAV_FLAG } from '../lib/new-case-nav';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

function PdfViewer({
  content,
  contentType,
  filename,
  parseSessionId,
  sessionIndex,
}: {
  content?: string;
  contentType?: string;
  filename: string;
  parseSessionId?: string | null;
  sessionIndex?: number | null;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfJsError, setPdfJsError] = useState<string | null>(null);
  const [remoteBytes, setRemoteBytes] = useState<Uint8Array | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const pdfOpenedRef = useRef(false);
  const pdfDebugOpenTsRef = useRef(0);

  const useSession =
    Boolean(parseSessionId) && typeof sessionIndex === 'number' && sessionIndex >= 0;

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
  }, [useSession, remoteBytes, content]);

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
    setPageNumber(1);
  }

  const legacyNoPayload = !useSession && !content;
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
            Documento Protegido (Vista Cifrada)
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
        <p className="text-[10px] text-slate-400">Vuelva a cargar el archivo .eml si la sesión expiró (aprox. 1 h).</p>
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

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 overflow-hidden">
      <div className="flex-1 overflow-auto p-4 flex justify-center">
        {pdfBlob ? (
          <div className="shadow-2xl">
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
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="max-w-full"
              />
            </Document>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-slate-200" />
          </div>
        )}
      </div>

      <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
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

interface LegalParty {
  nombre: string;
  identificacion: string;
  email: string;
}

interface LegalAnalysis {
  accionantes: LegalParty[];
  accionados: LegalParty[];
  derechoTutelado: string;
  hechos: string;
  pretensiones: string;
}

const NEW_CASE_DRAFT_KEY = 'tutelia_new_case_draft';
const AI_ANALYSIS_CACHE_KEY = 'tutelia_ai_analysis_cache_v2';

function normalizeLegalAnalysis(raw: unknown): LegalAnalysis {
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.accionantes) && Array.isArray(o.accionados)) {
    return {
      accionantes: (o.accionantes as LegalParty[]).map((p) => ({
        nombre: String(p?.nombre ?? ''),
        identificacion: String(p?.identificacion ?? ''),
        email: String(p?.email ?? ''),
      })),
      accionados: (o.accionados as LegalParty[]).map((p) => ({
        nombre: String(p?.nombre ?? ''),
        identificacion: String(p?.identificacion ?? ''),
        email: String(p?.email ?? ''),
      })),
      derechoTutelado: String(o.derechoTutelado ?? ''),
      hechos: String(o.hechos ?? ''),
      pretensiones: String(o.pretensiones ?? ''),
    };
  }
  return {
    accionantes: [
      {
        nombre: String(o.accionante ?? ''),
        identificacion: String(o.accionanteId ?? ''),
        email: String(o.accionanteEmail ?? ''),
      },
    ],
    accionados: [
      {
        nombre: String(o.accionado ?? ''),
        identificacion: String(o.accionadoId ?? ''),
        email: String(o.accionadoEmail ?? ''),
      },
    ],
    derechoTutelado: String(o.derechoTutelado ?? ''),
    hechos: String(o.hechos ?? ''),
    pretensiones: String(o.pretensiones ?? ''),
  };
}

function joinPartyField(parties: LegalParty[], key: keyof LegalParty): string {
  return parties
    .map((p) => (p[key] || '').trim())
    .filter(Boolean)
    .join('; ');
}

function buildLegalIdentificaciones(a: LegalAnalysis): string {
  const acc = a.accionantes
    .map((p) => {
      const n = (p.nombre || '').trim();
      const id = (p.identificacion || '').trim();
      if (n && id) return `${n} (${id})`;
      return n || id;
    })
    .filter(Boolean)
    .join(' | ');
  const def = a.accionados
    .map((p) => {
      const n = (p.nombre || '').trim();
      const id = (p.identificacion || '').trim();
      if (n && id) return `${n} (${id})`;
      return n || id;
    })
    .filter(Boolean)
    .join(' | ');
  const parts = [];
  if (acc) parts.push(`Accionantes: ${acc}`);
  if (def) parts.push(`Accionados: ${def}`);
  return parts.join(' — ');
}

function getUserFriendlyAiError(err: any): string {
  const status = err?.status;
  const rawMessage = String(err?.message || "");
  const normalized = rawMessage.toLowerCase();

  if (status === 429 || normalized.includes("resource_exhausted") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return "La cuota de OpenAI está agotada temporalmente (error 429). Espere unos segundos o revise límites/facturación.";
  }

  if (status === 404 || rawMessage.includes("models/") || rawMessage.includes("NOT_FOUND")) {
    return "El modelo de IA configurado no está disponible para esta API key.";
  }

  if (status === 401 || normalized.includes("incorrect api key") || normalized.includes("api key") || normalized.includes("unauthorized")) {
    return "La API key de OpenAI es inválida o no tiene permisos. Revise OPENAI_API_KEY en .env o .env.local.";
  }

  if (status === 413 || normalized.includes("entity too large")) {
    return "El documento es demasiado grande para procesarlo por API.";
  }

  return err?.message || "Error al analizar el documento con IA.";
}

function getUserFriendlyRadicadoError(err: any): string {
  const rawMessage = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toLowerCase();

  if (typeof err?.code === 'string' && (err.code.startsWith('auth') || err.code === '42501')) {
    return getSupabaseAuthErrorMessage(err);
  }

  if (rawMessage.includes('jwt') || rawMessage.includes('anonymous')) {
    return getSupabaseAuthErrorMessage(err);
  }

  if (
    rawMessage.includes('permission denied') ||
    rawMessage.includes('row-level security') ||
    rawMessage.includes('insufficient') ||
    code === '42501'
  ) {
    return 'Su usuario no tiene permisos en la base de datos. Verifique sesión y políticas RLS en Supabase.';
  }

  if (rawMessage.includes('bucket not found')) {
    return (
      'En Supabase no existe el bucket de almacenamiento «case-documents» (o el proyecto no coincide). ' +
      'En el panel: Storage → New bucket → id «case-documents», privado; o ejecute la migración ' +
      'supabase/migrations/20250428140000_case_documents_storage.sql en SQL Editor. Luego reinicie la radicación.'
    );
  }

  if (/notebook_code/i.test(String(err?.message || '')) && /schema cache|could not find/i.test(rawMessage)) {
    return (
      'Su proyecto Supabase no tiene la columna «notebook_code» en la tabla «case_documents». ' +
      'En Supabase → SQL Editor, ejecute el archivo supabase/migrations/20250428160000_case_documents_notebook.sql ' +
      'y vuelva a radicar. (La app puede reintentar sin esa columna, pero conviene aplicar la migración.)'
    );
  }

  return err?.message || 'Error desconocido al radicar expediente.';
}

export default function NewCase() {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [parseSessionId, setParseSessionId] = useState<string | null>(null);
  const [selectedDocIndex, setSelectedDocIndex] = useState<number>(-1); // -1 for CorreoReparto
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<LegalAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRadicating, setIsRadicating] = useState(false);
  const [consecutive, setConsecutive] = useState('');
  const [consecutiveLoading, setConsecutiveLoading] = useState(false);
  const [radicadoConflict, setRadicadoConflict] = useState<{
    raw: string;
    existingCaseId: string;
  } | null>(null);
  /** Tras radicar con éxito: dejamos de mostrar el formulario del consecutivo y pasamos a confirmación + redirección. */
  const [radicationResult, setRadicationResult] = useState<{
    caseId: string;
    radicado: string;
  } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const resetNewCaseWizard = useCallback(() => {
    localStorage.removeItem(NEW_CASE_DRAFT_KEY);
    setFile(null);
    setIsParsing(false);
    setParsedData(null);
    setAttachments([]);
    setParseSessionId(null);
    setSelectedDocIndex(-1);
    setSelectedForMerge([]);
    setEditingIndex(null);
    setEditingName('');
    setIsMerging(false);
    setAiAnalysis(null);
    setIsAnalyzing(false);
    setError(null);
    setIsRadicating(false);
    setConsecutive('');
    setConsecutiveLoading(false);
    setRadicadoConflict(null);
    setRadicationResult(null);
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(NEW_CASE_FRESH_NAV_FLAG) === '1') {
      sessionStorage.removeItem(NEW_CASE_FRESH_NAV_FLAG);
      resetNewCaseWizard();
      return;
    }
    try {
      const raw = localStorage.getItem(NEW_CASE_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft.parsedData) setParsedData(draft.parsedData);
      if (Array.isArray(draft.attachments)) setAttachments(draft.attachments);
      setParseSessionId(typeof draft.parseSessionId === 'string' ? draft.parseSessionId : null);
      if (typeof draft.selectedDocIndex === 'number') setSelectedDocIndex(draft.selectedDocIndex);
      if (Array.isArray(draft.selectedForMerge)) setSelectedForMerge(draft.selectedForMerge);
      if (draft.aiAnalysis) setAiAnalysis(normalizeLegalAnalysis(draft.aiAnalysis));
      if (typeof draft.consecutive === 'string') setConsecutive(draft.consecutive);
    } catch (e) {
      console.error('No se pudo restaurar borrador local de radicacion', e);
    }
  }, [location.key, resetNewCaseWizard]);

  useEffect(() => {
    const onFresh = () => resetNewCaseWizard();
    window.addEventListener(NEW_CASE_FRESH_EVENT, onFresh);
    return () => window.removeEventListener(NEW_CASE_FRESH_EVENT, onFresh);
  }, [resetNewCaseWizard]);

  const casesCourtId = 'court-1';

  useEffect(() => {
    if (!parsedData) return;
    let cancelled = false;
    setConsecutiveLoading(true);
    void (async () => {
      try {
        await ensureSupabaseSessionForWrites();
        const year = new Date().getFullYear().toString();
        const prefix =
          `${COURT_CONSTANTS.CITY_CODE}${COURT_CONSTANTS.ENTITY_CODE}` +
          `${COURT_CONSTANTS.SPECIALTY_CODE}${COURT_CONSTANTS.DESPACHO_CODE}${year}`;
        const res = await supabase
          .from('cases')
          .select('radicado')
          .eq('court_id', casesCourtId)
          .like('radicado', `${prefix}%`)
          .order('radicado', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (res.error) throw res.error;
        let next = 1;
        const raw = res.data?.radicado;
        if (typeof raw === 'string' && raw.length === 23) {
          const last = parseInt(raw.slice(16, 21), 10);
          if (!Number.isNaN(last)) next = last + 1;
        }
        if (next > 99999) next = 99999;
        setConsecutive(String(next));
      } catch (e) {
        if (!cancelled) {
          console.warn('No se pudo obtener el consecutivo sugerido', e);
          setConsecutive('1');
        }
      } finally {
        if (!cancelled) setConsecutiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parsedData]);

  useEffect(() => {
    if (!parsedData || radicationResult) return;
    try {
      localStorage.setItem(NEW_CASE_DRAFT_KEY, JSON.stringify({
        parsedData,
        attachments,
        parseSessionId,
        selectedDocIndex,
        selectedForMerge,
        aiAnalysis,
        consecutive,
      }));
    } catch (e) {
      console.error('No se pudo guardar borrador local de radicacion', e);
    }
  }, [parsedData, radicationResult, attachments, parseSessionId, selectedDocIndex, selectedForMerge, aiAnalysis, consecutive]);

  useEffect(() => {
    if (!radicationResult) return;
    const t = window.setTimeout(() => {
      navigate(`/case/${radicationResult.caseId}`);
    }, 2800);
    return () => window.clearTimeout(t);
  }, [radicationResult, navigate]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }, []);

  const parseEmail = async () => {
    if (!file) return;

    setIsParsing(true);
    setError(null);
    setRadicationResult(null);
    setParseSessionId(null);

    const formData = new FormData();
    formData.append('email', file);

    try {
      const response = await fetch('/api/parse-email', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Error al parsear el archivo');

      const data = await response.json();
      setParsedData(data);
      setParseSessionId(typeof data.parseSessionId === 'string' ? data.parseSessionId : null);
      setAttachments(data.attachments || []);
      setSelectedDocIndex(-1); // Default to CorreoReparto
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsParsing(false);
    }
  };

  const getFullRadicado = (cons: string) => {
    const year = new Date().getFullYear().toString();
    return `${COURT_CONSTANTS.CITY_CODE}${COURT_CONSTANTS.ENTITY_CODE}${COURT_CONSTANTS.SPECIALTY_CODE}${COURT_CONSTANTS.DESPACHO_CODE}${year}${cons.padStart(5, '0')}${COURT_CONSTANTS.INSTANCE_CODE}`;
  };

  const consecutiveNum = parseInt(consecutive.replace(/\D/g, ''), 10);
  const consecutiveReady =
    !consecutiveLoading && consecutive.length > 0 && !Number.isNaN(consecutiveNum) && consecutiveNum >= 1;

  const handleRadicate = async () => {
    console.log("Iniciando radicación...");
    if (!parsedData) {
      console.error("No hay datos parseados");
      return;
    }
    if (!consecutiveReady) {
      setError('Espere el consecutivo sugerido o indique un número válido (1–99999).');
      return;
    }
    
    setRadicadoConflict(null);
    setIsRadicating(true);
    setError(null);
    let uploadedStoragePaths: string[] = [];

    try {
      await ensureSupabaseSessionForWrites();
      const { data: authAfter } = await supabase.auth.getUser();
      if (!authAfter.user) {
        throw new Error('No hay sesión activa. Vuelva a iniciar sesión local o con Google para radicar.');
      }

      const finalConsecutive = consecutive.replace(/\D/g, '').padStart(5, '0');
      const radicadoFormatted = getFullRadicado(finalConsecutive);
      console.log('Radicado generado:', radicadoFormatted);

      let dup;
      try {
        const res = await supabase
          .from('cases')
          .select('id')
          .eq('court_id', casesCourtId)
          .eq('radicado', radicadoFormatted)
          .maybeSingle();
        dup = res.data;
        if (res.error) throw res.error;
      } catch (e) {
        await handleDataPermissionError(e, 'list', 'cases');
        throw e;
      }

      if (dup && typeof dup.id === 'string') {
        console.warn('Radicado ya existe');
        setRadicadoConflict({ raw: radicadoFormatted, existingCaseId: dup.id });
        setIsRadicating(false);
        return;
      }

      const claimantNames = aiAnalysis ? joinPartyField(aiAnalysis.accionantes, 'nombre') : '';
      const defendantNames = aiAnalysis ? joinPartyField(aiAnalysis.accionados, 'nombre') : '';
      const caseRow = {
        court_id: casesCourtId,
        radicado: radicadoFormatted,
        claimant: claimantNames || parsedData.from || 'Anónimo',
        defendant: defendantNames || 'DESPACHO JUDICIAL',
        status: 'received',
        source_channel: 'email',
        subject: parsedData.subject || 'Sin Asunto',
        raw_text: parsedData.text || '',
        summary: '',
        claimant_id: aiAnalysis ? joinPartyField(aiAnalysis.accionantes, 'identificacion') : '',
        claimant_email: aiAnalysis ? joinPartyField(aiAnalysis.accionantes, 'email') : '',
        defendant_id: aiAnalysis ? joinPartyField(aiAnalysis.accionados, 'identificacion') : '',
        defendant_email: aiAnalysis ? joinPartyField(aiAnalysis.accionados, 'email') : '',
        legal_hechos: aiAnalysis?.hechos || '',
        legal_pretensiones: aiAnalysis?.pretensiones || '',
        legal_derecho_tutelado: aiAnalysis?.derechoTutelado || '',
        legal_identificaciones: aiAnalysis ? buildLegalIdentificaciones(aiAnalysis) : '',
        raw_html: parsedData.html || '',
        email_metadata: {
          from: parsedData.from || '',
          to: parsedData.to || '',
          subject: parsedData.subject || '',
          date: parsedData.date || new Date().toISOString(),
          linkFound: !!parsedData.linkFound,
          linkUrl: parsedData.linkUrl || null,
        },
      };

      let caseId: string;
      try {
        const ins = await supabase.from('cases').insert(caseRow).select('id').single();
        if (ins.error) throw ins.error;
        caseId = ins.data!.id as string;
      } catch (e) {
        await handleDataPermissionError(e, 'create', 'cases');
        throw e;
      }
      console.log('Caso creado con ID:', caseId);

      const correoOriginalName = file?.name?.trim() || 'Correo de reparto.eml';
      const docRows: Array<Record<string, unknown>> = [
        {
          case_id: caseId,
          name: 'CorreoReparto',
          original_name: correoOriginalName,
          type: 'email_body',
          size: Math.round((parsedData.text?.length || 0) * 1.5),
          sort_order: -1,
          is_from_link: false,
          notebook_code: DEFAULT_NOTEBOOK_CODE,
        },
      ];

      if (attachments.length > 0) {
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          const hasInlineContent = typeof att.content === 'string' && att.content.length > 0;
          const canFetchSession =
            parseSessionId && typeof att.sessionIndex === 'number' && !hasInlineContent;

          if (!hasInlineContent && !canFetchSession) {
            docRows.push({
              case_id: caseId,
              name: att.filename,
              original_name: att.originalName || att.filename,
              type: 'attachment',
              size: att.size ?? 0,
              content_type: att.contentType,
              content: null,
              is_from_link: !!att.isFromLink,
              sort_order: i,
              notebook_code: DEFAULT_NOTEBOOK_CODE,
              error: 'Sin contenido binario para subir a Storage.',
            });
            continue;
          }
          let bytes: Uint8Array;
          try {
            if (canFetchSession && parseSessionId) {
              bytes = await fetchParseSessionAttachment(parseSessionId, att.sessionIndex);
            } else {
              bytes = base64ToUint8Array(att.content);
            }
          } catch {
            docRows.push({
              case_id: caseId,
              name: att.filename,
              original_name: att.originalName || att.filename,
              type: 'attachment',
              size: att.size ?? 0,
              content_type: att.contentType,
              content: null,
              is_from_link: !!att.isFromLink,
              sort_order: i,
              notebook_code: DEFAULT_NOTEBOOK_CODE,
              error: 'Base64 del adjunto inválido.',
            });
            continue;
          }
          const up = await uploadCaseAttachment(
            supabase,
            caseId,
            att.filename,
            bytes,
            att.contentType || 'application/octet-stream'
          );
          if ('error' in up) {
            await removeCaseDocumentObjects(supabase, uploadedStoragePaths);
            throw up.error;
          }
          uploadedStoragePaths.push(up.path);
          docRows.push({
            case_id: caseId,
            name: att.filename,
            original_name: att.originalName || att.filename,
            type: 'attachment',
            size: att.size ?? bytes.byteLength,
            content_type: att.contentType,
            content: null,
            storage_path: up.path,
            is_from_link: !!att.isFromLink,
            sort_order: i,
            notebook_code: DEFAULT_NOTEBOOK_CODE,
          });
        }
      }

      const { error: docErr } = await insertCaseDocumentRows(supabase, docRows);
      if (docErr) {
        await handleDataPermissionError(docErr, 'create', 'case_documents');
        await removeCaseDocumentObjects(supabase, uploadedStoragePaths);
        const { error: delErr } = await supabase.from('cases').delete().eq('id', caseId);
        if (delErr) console.error('No se pudo revertir el expediente tras fallo en anexos:', delErr);
        throw docErr;
      }

      console.log('Radicación completada con éxito. Redirigiendo...');
      localStorage.removeItem(NEW_CASE_DRAFT_KEY);
      setRadicationResult({ caseId, radicado: radicadoFormatted });
    } catch (err: any) {
      console.error("Error al radicar:", err);
      if (uploadedStoragePaths.length > 0) {
        await removeCaseDocumentObjects(supabase, uploadedStoragePaths);
        uploadedStoragePaths = [];
      }
      let errorMsg = getUserFriendlyRadicadoError(err);
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) errorMsg = parsed.error;
      } catch (e) {
        // keep friendly mapped message
      }
      setError(`Error de radicación: ${errorMsg}`);
    } finally {
      setIsRadicating(false);
    }
  };

  const handleRename = (idx: number) => {
    const newAttachments = [...attachments];
    newAttachments[idx].filename = editingName;
    setAttachments(newAttachments);
    setEditingIndex(null);
  };

  const handleMove = (idx: number, direction: 'up' | 'down') => {
    const newAttachments = [...attachments];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newAttachments.length) return;
    
    [newAttachments[idx], newAttachments[targetIdx]] = [newAttachments[targetIdx], newAttachments[idx]];
    setAttachments(newAttachments);
    if (selectedDocIndex === idx) setSelectedDocIndex(targetIdx);
    else if (selectedDocIndex === targetIdx) setSelectedDocIndex(idx);
  };

  const toggleSelectForMerge = (idx: number) => {
    setSelectedForMerge(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const mergeSelected = async () => {
    if (selectedForMerge.length <= 1) {
      setError('Seleccione al menos 2 documentos para unir.');
      return;
    }

    const itemsToMerge = selectedForMerge
      .map(idx => attachments[idx])
      .filter(att => att.contentType === 'application/pdf');

    if (itemsToMerge.length !== selectedForMerge.length) {
      setError('Solo se pueden unir archivos PDF.');
      return;
    }

    setIsMerging(true);
    try {
      const mergedPdf = await PDFDocument.create();
      
      for (const att of itemsToMerge) {
        const hasInline = typeof att.content === 'string' && att.content.length > 0;
        const pdfBytes =
          parseSessionId && typeof att.sessionIndex === 'number' && !hasInline
            ? await fetchParseSessionAttachment(parseSessionId, att.sessionIndex)
            : Uint8Array.from(atob(att.content), (c) => c.charCodeAt(0));
        const donorPdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBase64 = await mergedPdf.saveAsBase64();
      
      // Determine new list: remove selected, insert merged at first selected position
      const firstSelectedIdx = Math.min(...selectedForMerge);
      const newAttachments = attachments.filter((_, idx) => !selectedForMerge.includes(idx));
      
      const mergedDoc = {
        filename: 'DocumentosUnificados.pdf',
        originalName: 'DocumentosUnificados.pdf',
        size: Math.round(mergedPdfBase64.length * 0.75),
        contentType: 'application/pdf',
        content: mergedPdfBase64,
        isFromLink: itemsToMerge.some((a) => a.isFromLink),
      };

      newAttachments.splice(firstSelectedIdx, 0, mergedDoc);
      setAttachments(newAttachments);
      setSelectedDocIndex(firstSelectedIdx);
      setSelectedForMerge([]);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Error al unir los documentos. Asegúrese de que sean PDF válidos.');
    } finally {
      setIsMerging(false);
    }
  };

  const handleAIAnalysis = async () => {
    const currentDoc = selectedDocIndex === -1 ? null : attachments[selectedDocIndex];
    if (!currentDoc || currentDoc.contentType !== 'application/pdf') {
      setError('Por favor, seleccione un documento PDF (ej. el escrito) para analizar con IA.');
      return;
    }
    
    setIsAnalyzing(true);
    setError(null);
    try {
      const hasInline = typeof currentDoc.content === 'string' && currentDoc.content.length > 0;
      const cacheKey =
        parseSessionId && typeof currentDoc.sessionIndex === 'number' && !hasInline
          ? `${currentDoc.filename || 'doc'}::sess::${parseSessionId}::${currentDoc.sessionIndex}`
          : `${currentDoc.filename || 'doc'}::${currentDoc.size || 0}::${(currentDoc.content || '').slice(0, 64)}`;
      const rawCache = localStorage.getItem(AI_ANALYSIS_CACHE_KEY);
      if (rawCache) {
        const parsedCache = JSON.parse(rawCache) as Record<string, LegalAnalysis>;
        if (parsedCache[cacheKey]) {
          setAiAnalysis(normalizeLegalAnalysis(parsedCache[cacheKey]));
          setIsAnalyzing(false);
          return;
        }
      }

      const rightsListText = RIGHTS_LIST.map(r => `Art. ${r.art} — ${r.title}`).join('\n');

      const prompt = `
        Analiza este documento de tutela y extrae la siguiente información de manera muy precisa y breve:
        - Accionantes: lista de TODOS los demandantes que figuren como tales (párrafo introductorio, encabezado «DE:», «accionantes», etc.). Cada uno con nombre completo, identificación (C.C. o NIT con número) y correo si consta; si no consta correo, deja email vacío.
        - Accionados: lista de TODAS las entidades o personas demandadas (EPS, aseguradora, FOMAT, hospital, etc.). Una entrada por cada accionado distinto. Misma regla de identificación y email.
        - Si hay varios accionantes o varios accionados, inclúyelos todos; no omitas coprocuradores ni codemandados.
        - Si solo consta un demandante o un demandado, el arreglo tendrá un solo elemento.
        - Derecho fundamental tutelado: DEBE ser estrictamente uno de los siguientes de la Constitución Colombiana:
        ${rightsListText}
        
        IMPORTANTE: Si el derecho mencionado no está exactamente en esa lista, identifícalo bajo el artículo más relacionado de esa lista específica (Arts 11 al 41).
        
        - Hechos: Resumen extremadamente breve de lo ocurrido, máximo 2 frases.
        - Pretensiones: Resumen extremadamente breve de lo que se pide, máximo 2 frases.

        Responde estrictamente en formato JSON según el esquema proporcionado.
      `;

      let pdfBase64 = hasInline ? currentDoc.content : '';
      if (!pdfBase64 && parseSessionId && typeof currentDoc.sessionIndex === 'number') {
        const u8 = await fetchParseSessionAttachment(parseSessionId, currentDoc.sessionIndex);
        pdfBase64 = uint8ArrayToBase64(u8);
      }
      if (!pdfBase64) {
        throw new Error('No hay datos PDF para enviar a la IA.');
      }

      const response = await fetch('/api/ai/legal-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          pdfBase64,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw Object.assign(new Error(payload.error || 'Error al analizar el documento con IA.'), {
          status: response.status,
        });
      }

      const payload = await response.json();
      const normalized = normalizeLegalAnalysis(JSON.parse(payload.text || '{}'));
      setAiAnalysis(normalized);
      const raw = localStorage.getItem(AI_ANALYSIS_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      cache[cacheKey] = normalized;
      localStorage.setItem(AI_ANALYSIS_CACHE_KEY, JSON.stringify(cache));
    } catch (err: any) {
      console.error("AI Analysis Error:", err);
      setError(getUserFriendlyAiError(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Radicación de Expediente</h1>
          <p className="text-sm font-medium text-slate-500 mt-1">Ingesta automática y normalización de documentos judicial electrónicos</p>
        </div>
        <div className="px-4 py-2 bg-blue-50 text-accent rounded-lg border border-blue-100 text-xs font-bold uppercase tracking-widest">
           Canal Digital
        </div>
      </header>

      {!parsedData ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-modern p-12"
        >
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
              onChange={handleFileChange}
            />
            <label 
              htmlFor="file-upload"
              className="px-8 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm text-slate-600 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-all shadow-sm"
            >
              BUSCAR EN ESTE EQUIPO
            </label>
            
            {file && (
              <div className="flex items-center gap-3 mt-4 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100 animate-in fade-in zoom-in duration-300 text-xs font-bold">
                <FileText className="w-4 h-4" />
                {file.name}
              </div>
            )}
          </div>

          {file && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="pt-10"
            >
              <button 
                onClick={parseEmail}
                disabled={isParsing}
                className="btn-primary w-full flex items-center justify-center gap-3 text-lg py-5 shadow-lg shadow-accent/20"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    ANALIZANDO CONTENIDO Y ANEXOS...
                  </>
                ) : (
                  <>
                    PROCESAR E INGESTAR EXPEDIENTE
                    <ArrowRight className="w-6 h-6" />
                  </>
                )}
              </button>
            </motion.div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 flex items-center gap-3 text-sm font-semibold">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </div>
          )}
        </motion.div>
      ) : radicationResult ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-modern overflow-hidden border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white p-10 text-center shadow-lg sm:p-14"
        >
          <CheckCircle2 className="mx-auto mb-6 h-16 w-16 text-emerald-600" aria-hidden />
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Listo, radicada</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm font-medium leading-relaxed text-slate-600">
            La tutela quedó registrada. Esta pantalla ya no muestra el formulario del consecutivo para evitar confusiones con un
            segundo intento de radicación.
          </p>
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-slate-200 bg-white px-6 py-5 text-left shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Número de expediente</p>
            <p className="mt-2 break-all font-mono text-lg font-bold text-accent">
              {formatRadicado(radicationResult.radicado)}
            </p>
          </div>
          <p className="mt-6 text-xs text-slate-500">
            Abriendo el expediente en unos segundos… Si no redirige, use el botón siguiente.
          </p>
          <Link
            to={`/case/${radicationResult.caseId}`}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-md hover:opacity-95"
          >
            Abrir expediente ahora
            <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
          {/* Top Bar & Radicado Section (Full Width) */}
          <div className="lg:col-span-12 space-y-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => resetNewCaseWizard()}
                className="text-xs font-bold text-slate-400 hover:text-accent flex items-center gap-1"
              >
                <ChevronLeft className="w-3 h-3" /> VOLVER A CARGAR
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-slate-500">
                <span className="font-medium text-slate-600 flex items-center gap-1">
                  <Edit2 className="w-3 h-3 text-slate-400 shrink-0" />
                  Radicado (Ac. 201/1997 CSJ)
                </span>
                {consecutiveLoading ? (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Consecutivo…
                  </span>
                ) : consecutiveReady ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <Check className="w-3 h-3 shrink-0" />
                    Consecutivo listo
                  </span>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs font-mono text-slate-700">
                <span className="tabular-nums">{COURT_CONSTANTS.CITY_CODE}</span>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{COURT_CONSTANTS.ENTITY_CODE}</span>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{COURT_CONSTANTS.SPECIALTY_CODE}</span>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{COURT_CONSTANTS.DESPACHO_CODE}</span>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{new Date().getFullYear()}</span>
                <span className="text-slate-300">·</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={consecutive}
                  onChange={(e) => setConsecutive(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  disabled={consecutiveLoading}
                  className="w-[4.25rem] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-xs font-semibold text-slate-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
                  placeholder="—"
                  title="Consecutivo de proceso (5 dígitos). Se sugiere el siguiente al último radicado en este despacho y año."
                />
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{COURT_CONSTANTS.INSTANCE_CODE}</span>
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
                El consecutivo se propone según el último expediente ya radicado en este despacho para el año en curso; puede corregirlo si corresponde.
              </p>

              {radicadoConflict && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-3 text-red-600 text-[10px] font-bold uppercase tracking-widest"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div className="flex flex-col gap-2 max-w-full">
                    <span className="text-[11px] font-black">Conflicto de radicación detectado</span>
                    <p className="font-bold normal-case tracking-normal text-sm text-red-700/90 leading-snug">
                      El radicado <span className="font-mono">{formatRadicado(radicadoConflict.raw)}</span> ya está en la
                      tabla <span className="font-mono">cases</span> de Supabase para este despacho.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link
                        to={`/case/${radicadoConflict.existingCaseId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-[11px] font-bold text-red-700 normal-case tracking-normal hover:bg-red-50"
                      >
                        Abrir expediente existente
                      </Link>
                      <Link
                        to={`/cases?q=${encodeURIComponent(radicadoConflict.raw)}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-[11px] font-bold text-red-700 normal-case tracking-normal hover:bg-red-50"
                      >
                        Ver en listado de expedientes
                      </Link>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* AI Analysis (Full Width) */}
          <AnimatePresence mode="wait">
            {aiAnalysis && (
              <motion.div 
                key="ai-panel"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="lg:col-span-12 overflow-hidden"
              >
                <div className="card-modern p-10 space-y-8 border-accent/20 bg-blue-50/10 shadow-2xl shadow-accent/5 backdrop-blur-sm mb-8">
                  <div className="flex items-center justify-between border-b border-accent/10 pb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-accent rounded-2xl flex items-center justify-center shadow-lg shadow-accent/20">
                        <Sparkles className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 leading-none">Análisis por Inteligencia Artificial</h3>
                        <p className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1.5 opacity-70">Extracción automática de datos judiciales bajo C.P.C.</p>
                      </div>
                    </div>
                    <button onClick={() => setAiAnalysis(null)} className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-xl transition-all">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Accionantes (Demandantes){aiAnalysis.accionantes.length > 1 ? ` (${aiAnalysis.accionantes.length})` : ''}
                        </label>
                        <div className="space-y-3">
                          {aiAnalysis.accionantes.map((p, i) => (
                            <div key={`acc-${i}`} className="space-y-1 border-b border-slate-100/80 pb-3 last:border-0 last:pb-0">
                              <p className="text-sm font-black text-slate-800 leading-tight">{p.nombre || '—'}</p>
                              <p className="text-[10px] font-mono font-bold text-accent bg-accent/5 px-2 py-0.5 rounded-md inline-block uppercase">
                                {p.identificacion?.trim() || 'C.C. NO DETECTADA'}
                              </p>
                              <p className="text-[10px] text-slate-500 font-medium truncate">{p.email?.trim() || 'Email no detectado'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Accionados (Contraparte){aiAnalysis.accionados.length > 1 ? ` (${aiAnalysis.accionados.length})` : ''}
                        </label>
                        <div className="space-y-3">
                          {aiAnalysis.accionados.map((p, i) => (
                            <div key={`acd-${i}`} className="space-y-1 border-b border-slate-100/80 pb-3 last:border-0 last:pb-0">
                              <p className="text-sm font-black text-slate-800 leading-tight">{p.nombre || '—'}</p>
                              <p className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md inline-block uppercase">
                                {p.identificacion?.trim() || 'NIT / ID NO DETECTADO'}
                              </p>
                              <p className="text-[10px] text-slate-500 font-medium truncate">{p.email?.trim() || 'Email no detectado'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Derecho Tutelado
                        </label>
                        <div className="bg-emerald-50 border border-emerald-100 px-4 py-2.5 rounded-2xl text-[11px] font-black text-emerald-700 inline-block uppercase shadow-sm">
                          {aiAnalysis.derechoTutelado}
                        </div>
                      </div>
                      <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Resumen de Pretensión</label>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed mt-2 italic">
                          "{aiAnalysis.pretensiones}"
                        </p>
                      </div>
                    </div>

                    <div className="md:col-span-2 space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Resumen de Hechos Relevantes</label>
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-full flex flex-col justify-center">
                        <p className="text-[11px] text-slate-600 font-medium leading-loose italic">
                          "{aiAnalysis.hechos}"
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Grid: Actions & Viewer */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {!aiAnalysis && (
              <div className="p-4 bg-amber-50 text-amber-700 rounded-2xl border border-amber-100 text-[10px] font-bold uppercase tracking-widest flex items-center gap-3 animate-pulse">
                <AlertCircle className="w-4 h-4" /> Se recomienda extraer datos con IA antes de radicar
              </div>
            )}

            {aiAnalysis && (
              <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100 text-[10px] font-bold uppercase tracking-widest flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4" /> Datos extraídos con IA listos para vinculación
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 flex items-center gap-3 text-xs font-semibold">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}

            <button 
              onClick={handleRadicate}
              disabled={isRadicating || !consecutiveReady}
              className={`w-full py-6 rounded-2xl text-sm font-black uppercase tracking-[0.15em] flex items-center justify-center gap-4 transition-all duration-300 relative overflow-hidden group ${
                isRadicating 
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
                  : 'bg-accent text-white shadow-2xl shadow-accent/20 hover:shadow-accent/40 active:scale-[0.98] border border-accent/20'
              }`}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              
              {isRadicating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Radicando Proceso...</span>
                </>
              ) : (
                <>
                  {aiAnalysis && <Sparkles className="w-5 h-5 text-blue-200" />}
                  <span>Radicar y Vincular Expediente</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

            <div className="card-modern p-8 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Metadatos Extraídos</h2>
                <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asunto del Correo</label>
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl font-bold text-slate-700 text-sm">
                    {parsedData.subject || 'SIN TÍTULO DETECTADO'}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interviniente (Accionante)</label>
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-600 text-sm font-medium truncate">
                    {parsedData.from}
                  </div>
                </div>

                {parsedData.linkFound && (
                  <div className="space-y-1.5 pt-2">
                    <label className="text-[10px] font-bold text-blue-500 uppercase tracking-widest px-1 flex items-center gap-2">
                      <ExternalLink className="w-3 h-3" /> Link "Archivo" Detectado
                    </label>
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-blue-700 text-[11px] font-medium break-all flex flex-col gap-2">
                      <span className="opacity-70">Se detectó y procesó automáticamente el link de descarga mencionado en el cuerpo del correo.</span>
                      <div className="bg-white/80 p-2 rounded-lg border border-blue-200/50 truncate">
                        {parsedData.linkUrl}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 flex items-center justify-between">
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Documentos Identificados</label>
                   <button 
                     onClick={mergeSelected}
                     disabled={isMerging || selectedForMerge.length <= 1}
                     className={`text-[9px] font-black tracking-tighter uppercase px-2 py-1 rounded-lg border flex items-center gap-1.5 transition-all ${
                       selectedForMerge.length > 1 
                         ? 'bg-accent text-white border-accent hover:bg-accent-dark' 
                         : 'bg-slate-100 text-slate-400 border-slate-200 opacity-60'
                     }`}
                   >
                     {isMerging ? <Loader2 className="w-3 h-3 animate-spin"/> : <Combine className="w-3 h-3" />}
                     Unir Seleccionados ({selectedForMerge.length})
                   </button>
                </div>

                <div className="space-y-1.5">
                  <div className="grid grid-cols-1 gap-2.5">
                    {/* Correo Principal */}
                    <div 
                      onClick={() => setSelectedDocIndex(-1)}
                      className={`flex items-center justify-between p-3.5 border rounded-xl text-[11px] font-bold cursor-pointer transition-all duration-200 group ${
                        selectedDocIndex === -1 
                          ? 'border-accent bg-blue-50/50 text-accent ring-2 ring-accent/5 translate-x-1' 
                          : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                        <span className="flex items-center gap-2.5">
                           <div className={`p-1.5 rounded-lg ${selectedDocIndex === -1 ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'}`}>
                              <FileText className="w-3.5 h-3.5" />
                           </div>
                           CorreoReparto
                        </span>
                        <div className="flex items-center gap-2">
                           <span className={`text-[8px] px-2 py-0.5 rounded-full font-black tracking-tighter uppercase ${
                             selectedDocIndex === -1 ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400'
                           }`}>Principal</span>
                        </div>
                    </div>

                    {/* Otros Adjuntos */}
                    {attachments.map((att: any, idx: number) => (
                      <div 
                        key={idx} 
                        className={`group relative flex items-center justify-between p-3.5 border rounded-xl text-[11px] font-bold transition-all duration-200 ${
                          selectedDocIndex === idx 
                            ? 'border-accent bg-blue-50/50 text-accent ring-2 ring-accent/5 translate-x-1' 
                            : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                           {att.contentType === 'application/pdf' && (
                             <input 
                               type="checkbox"
                               checked={selectedForMerge.includes(idx)}
                               onChange={() => toggleSelectForMerge(idx)}
                               onClick={(e) => e.stopPropagation()}
                               className="w-4 h-4 rounded border-slate-300 text-accent focus:ring-accent accent-accent cursor-pointer"
                             />
                           )}
                           <div 
                              onClick={() => setSelectedDocIndex(idx)}
                              className="flex-1 cursor-pointer flex items-center gap-2.5 min-w-0"
                           >
                              <div className={`p-1.5 rounded-lg shrink-0 ${selectedDocIndex === idx ? 'bg-accent text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'}`}>
                                 <FileText className="w-3.5 h-3.5" />
                              </div>
                              {editingIndex === idx ? (
                                <div className="flex items-center gap-1 min-w-0 flex-1 bg-white" onClick={(e) => e.stopPropagation()}>
                                  <input 
                                    type="text" 
                                    value={editingName} 
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleRename(idx);
                                      if (e.key === 'Escape') setEditingIndex(null);
                                    }}
                                    className="flex-1 bg-slate-50 border border-accent/30 rounded px-2 py-1 text-[11px] font-bold focus:ring-2 focus:ring-accent/20 outline-none min-w-0 shadow-inner"
                                    autoFocus
                                  />
                                  <div className="flex items-center gap-0.5 shrink-0 ml-1">
                                    <button 
                                      onClick={() => handleRename(idx)} 
                                      className="text-white bg-emerald-500 p-1 hover:bg-emerald-600 rounded transition-colors shadow-sm"
                                      title="Confirmar (Enter)"
                                    >
                                      <Check className="w-3.5 h-3.5"/>
                                    </button>
                                    <button 
                                      onClick={() => setEditingIndex(null)} 
                                      className="text-slate-400 bg-slate-100 p-1 hover:bg-slate-200 rounded transition-colors"
                                      title="Cancelar (Esc)"
                                    >
                                      <X className="w-3.5 h-3.5"/>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <span className="truncate">{att.filename}</span>
                              )}
                           </div>
                        </div>

                        <div className="flex items-center gap-2 ml-2">
                           {!editingIndex && (
                             <div className="hidden group-hover:flex items-center gap-1 pr-1 border-r border-slate-100 mr-1">
                               <button 
                                 onClick={(e) => { e.stopPropagation(); setEditingIndex(idx); setEditingName(att.filename); }}
                                 className="p-1 text-slate-400 hover:text-accent hover:bg-white rounded transition-colors"
                                 title="Renombrar"
                               >
                                 <Edit2 className="w-3 h-3" />
                               </button>
                               <div className="flex flex-col">
                                 <button 
                                   onClick={(e) => { e.stopPropagation(); handleMove(idx, 'up'); }}
                                   disabled={idx === 0}
                                   className="p-0.5 text-slate-400 hover:text-accent disabled:opacity-20"
                                   title="Subir"
                                 >
                                   <ArrowUp className="w-2.5 h-2.5" />
                                 </button>
                                 <button 
                                   onClick={(e) => { e.stopPropagation(); handleMove(idx, 'down'); }}
                                   disabled={idx === attachments.length - 1}
                                   className="p-0.5 text-slate-400 hover:text-accent disabled:opacity-20"
                                   title="Bajar"
                                 >
                                   <ArrowDown className="w-2.5 h-2.5" />
                                 </button>
                               </div>
                             </div>
                           )}
                           
                           {att.isFromLink && (
                             <span className="text-[8px] font-black tracking-tighter uppercase text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                               LINK
                             </span>
                           )}
                           <span className="text-[10px] tabular-nums font-medium text-slate-300">{(att.size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Viewer Section */}
          <div className="lg:col-span-7 card-modern overflow-hidden bg-white flex flex-col h-[750px]">
             <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                    {selectedDocIndex === -1 ? 'Vista Previa del Correo Judicial' : `Visor: ${attachments[selectedDocIndex]?.filename}`}
                  </h2>
                  {selectedDocIndex !== -1 && attachments[selectedDocIndex]?.contentType === 'application/pdf' && (
                    <button 
                      onClick={handleAIAnalysis}
                      disabled={isAnalyzing}
                      className="px-3 py-1 bg-accent text-white rounded-lg text-[9px] font-black uppercase tracking-tighter flex items-center gap-1.5 hover:bg-accent-dark transition-all shadow-sm shadow-accent/20 disabled:opacity-50"
                    >
                      {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin"/> : <Search className="w-3 h-3" />}
                      {isAnalyzing ? 'Analizando...' : 'Extraer Datos con IA'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold">
                   <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                   REPRODUCCIÓN DIGITAL
                </div>
             </div>
             
             <div className="flex-1 overflow-hidden bg-white flex flex-col">
               {selectedDocIndex === -1 ? (
                 <>
                   <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-1 text-[10px]">
                     <div className="flex gap-2">
                         <span className="font-bold text-slate-400 w-12 uppercase">De:</span>
                         <span className="text-slate-600 truncate">{parsedData.from}</span>
                     </div>
                     <div className="flex gap-2">
                         <span className="font-bold text-slate-400 w-12 uppercase">Fecha:</span>
                         <span className="text-slate-600">{parsedData.date ? new Date(parsedData.date).toLocaleString('es-CO') : 'Reciente'}</span>
                     </div>
                   </div>
                   <div className="flex-1 bg-white">
                     {parsedData.html ? (
                       <iframe 
                         srcDoc={`
                           <html>
                             <head>
                               <style>
                                 body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #334155; padding: 20px; margin: 0; }
                                 img { max-width: 100%; height: auto; }
                               </style>
                             </head>
                             <body>${parsedData.html}</body>
                           </html>
                         `}
                         className="w-full h-full border-none"
                         title="Email Body"
                       />
                     ) : (
                       <div className="p-10 font-sans text-sm text-slate-600 whitespace-pre-wrap">
                         {parsedData.text}
                       </div>
                     )}
                   </div>
                 </>
               ) : (
                 <div className="flex-1 flex flex-col h-full bg-slate-100 min-h-0 overflow-hidden">
                   <PdfViewer
                     key={`${selectedDocIndex}-${attachments[selectedDocIndex]?.filename ?? ''}-${parseSessionId ?? ''}`}
                     content={attachments[selectedDocIndex]?.content}
                     contentType={attachments[selectedDocIndex]?.contentType}
                     filename={attachments[selectedDocIndex]?.filename}
                     parseSessionId={parseSessionId}
                     sessionIndex={
                       typeof attachments[selectedDocIndex]?.sessionIndex === 'number'
                         ? attachments[selectedDocIndex].sessionIndex
                         : null
                     }
                   />
                 </div>
               )}
             </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
