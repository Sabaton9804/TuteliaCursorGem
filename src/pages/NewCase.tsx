import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ArrowRight, 
  ChevronLeft,
  Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import { getSupabaseAuthErrorMessage } from '../lib/supabase-auth-errors';
import { handleDataPermissionError } from '../lib/error-handler';
import { motion } from 'motion/react';
import { PDFDocument } from 'pdf-lib';
import { COURT_CONSTANTS, RIGHTS_LIST } from '../constants';
import { formatRadicado } from '../lib/formatters';
import {
  buildRadicadoPrimeraInstancia,
  cuiBase21,
  deriveRadicadoSegundaInstancia,
} from '../lib/radicado-cui';
import {
  base64ToUint8Array,
  insertCaseDocumentRows,
  removeCaseDocumentObjects,
  uploadCaseAttachment,
} from '../lib/case-document-storage';
import { notebookCodeForCaseType, NOTEBOOK_SI_C01_PRINCIPAL } from '../lib/expediente-notebook';
import { sgdeCreateExpediente, sgdeMigrateOriginToCase, sgdeSyncDocuments, type SgdePreflightResult } from '../lib/sgde-api';
import {
  extractSegundaInstanciaFromParsedEmail,
  shouldUseSegundaInstanciaFlow,
} from '../lib/segunda-instancia-email';
import { CaseSgdeSegundaPreflightPanel } from '../components/new-case/CaseSgdeSegundaPreflightPanel';
import { fetchParseSessionAttachment, uint8ArrayToBase64 } from '../lib/parse-session-attachment';
import { NEW_CASE_FRESH_EVENT, NEW_CASE_FRESH_NAV_FLAG } from '../lib/new-case-nav';
import { guessDerechoTuteladoCodeFromText } from '../lib/sierju-case-codes';
import { startOfLocalDay, tenthBusinessDayDeadline } from '../lib/business-days';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import {
  computeInitialAssignedTo,
  parseSustanciadorAssignmentMode,
  SUSTANCIADOR_ASSIGNMENT_MODE_AUDIT,
} from '../lib/sustanciador-reparto';
import { insertAssignmentNotificationsForProfiles } from '../lib/assignment-notifications';
import { openRadicacionStageAfterRadicate } from '../lib/case-stages-service';
import { deepSanitizeForPostgresInsert } from '../lib/sanitize-for-postgres';
import type { CaseAppellant, CaseOriginRuling, CaseType } from '../types';
import type { LegalAnalysis, LegalParty } from '../components/new-case/new-case-types';
import { CaseRadicacionActions, CaseRadicacionConsecutivePanel } from '../components/new-case/CaseRadicacionActions';
import { CASE_TYPE_CARD_COPY, validateCaseOriginForRadicate } from '../hooks/useNewCaseForm';
import { CaseTypeSelector } from '../components/new-case/CaseTypeSelector';
import { CaseEmailParser } from '../components/new-case/CaseEmailParser';
import { CaseFormSegundaInstancia } from '../components/new-case/CaseFormSegundaInstancia';
import { CaseFormConsultaDesacato } from '../components/new-case/CaseFormConsultaDesacato';
import { CasePdfViewer } from '../components/new-case/CasePdfViewer';
import { CaseLegalAnalysisPanel } from '../components/new-case/CaseLegalAnalysisPanel';

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

  if (rawMessage.includes('unsupported unicode escape')) {
    return (
      'El contenido del correo o de la IA incluye caracteres que la base de datos no admite en metadatos JSON ' +
      '(p. ej. bytes nulos o texto mal codificado). Intente de nuevo; si persiste, reenvíe el correo o quite anexos problemáticos.'
    );
  }

  return err?.message || 'Error desconocido al radicar expediente.';
}

function NewCaseOriginFlowFields({
  caseFlowType,
  originCourt,
  setOriginCourt,
  originRadicado,
  setOriginRadicado,
  appellantSel,
  setAppellantSel,
  originRulingSel,
  setOriginRulingSel,
  conductDescription,
  setConductDescription,
}: {
  caseFlowType: CaseType;
  originCourt: string;
  setOriginCourt: (v: string) => void;
  originRadicado: string;
  setOriginRadicado: (v: string) => void;
  appellantSel: '' | CaseAppellant;
  setAppellantSel: (v: '' | CaseAppellant) => void;
  originRulingSel: '' | CaseOriginRuling;
  setOriginRulingSel: (v: '' | CaseOriginRuling) => void;
  conductDescription: string;
  setConductDescription: (v: string) => void;
}) {
  if (caseFlowType === 'tutela_primera') return null;
  if (caseFlowType === 'tutela_segunda') {
    return (
      <CaseFormSegundaInstancia
        originCourt={originCourt}
        setOriginCourt={setOriginCourt}
        originRadicado={originRadicado}
        setOriginRadicado={setOriginRadicado}
        appellantSel={appellantSel}
        setAppellantSel={setAppellantSel}
        originRulingSel={originRulingSel}
        setOriginRulingSel={setOriginRulingSel}
      />
    );
  }
  return (
    <CaseFormConsultaDesacato
      originCourt={originCourt}
      setOriginCourt={setOriginCourt}
      originRadicado={originRadicado}
      setOriginRadicado={setOriginRadicado}
      conductDescription={conductDescription}
      setConductDescription={setConductDescription}
    />
  );
}

export default function NewCase() {
  const { courtId } = useSessionCourt();
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
  const [caseFlowType, setCaseFlowType] = useState<CaseType | null>(null);
  const [originCourt, setOriginCourt] = useState('');
  const [originRadicado, setOriginRadicado] = useState('');
  const [appellantSel, setAppellantSel] = useState<'' | CaseAppellant>('');
  const [originRulingSel, setOriginRulingSel] = useState<'' | CaseOriginRuling>('');
  const [conductDescription, setConductDescription] = useState('');
  const [sgdePreflight, setSgdePreflight] = useState<SgdePreflightResult | null>(null);
  const [sgdeNodeIdHint, setSgdeNodeIdHint] = useState<string | null>(null);
  const [segundaPrefillNote, setSegundaPrefillNote] = useState<string | null>(null);
  /** Radicados Tutelia con la misma base CUI (21 díg.) para calcular sufijo 01, 02… */
  const [segundaKnownRadicados, setSegundaKnownRadicados] = useState<string[]>([]);
  const [segundaSuffixLoading, setSegundaSuffixLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const applySegundaInstanciaPrefill = useCallback(
    (parsed: Record<string, unknown>, opts?: { forceFlowType?: boolean }) => {
      const si = extractSegundaInstanciaFromParsedEmail(parsed);
      if (!shouldUseSegundaInstanciaFlow(si)) return false;
      if (opts?.forceFlowType || !caseFlowType) {
        setCaseFlowType('tutela_segunda');
      }
      if (si.originRadicado) setOriginRadicado(si.originRadicado);
      if (si.originCourt) setOriginCourt(si.originCourt);
      if (si.sgdeNodeId) setSgdeNodeIdHint(si.sgdeNodeId);
      setSegundaPrefillNote(
        `Origen detectado en el correo: ${si.originCourt || 'juzgado en SGDE'} · CUI ${si.originRadicado}` +
          (si.repartoSecuencia ? ` · Reparto ${si.repartoSecuencia}` : '')
      );
      return true;
    },
    [caseFlowType]
  );

  useEffect(() => {
    if (!parsedData) return;
    applySegundaInstanciaPrefill(parsedData as Record<string, unknown>);
  }, [parsedData, applySegundaInstanciaPrefill]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('fromOutlook') !== '1') return;
    const raw = sessionStorage.getItem('tutelia_outlook_radicacion');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as {
        parseSessionId?: string;
        attachments?: unknown[];
        segundaInstancia?: {
          isSegundaInstancia?: boolean;
          originRadicado?: string | null;
          originCourt?: string | null;
        };
        [key: string]: unknown;
      };
      setParsedData(data);
      setParseSessionId(typeof data.parseSessionId === 'string' ? data.parseSessionId : null);
      setAttachments(Array.isArray(data.attachments) ? data.attachments : []);
      setSelectedDocIndex(-1);
      setError(null);
      applySegundaInstanciaPrefill(data, { forceFlowType: true });
      sessionStorage.removeItem('tutelia_outlook_radicacion');
      navigate('/new', { replace: true });
    } catch {
      setError('No se pudo cargar el correo importado desde Outlook.');
    }
  }, [location.search, navigate, applySegundaInstanciaPrefill]);

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
    setCaseFlowType(null);
    setOriginCourt('');
    setOriginRadicado('');
    setAppellantSel('');
    setOriginRulingSel('');
    setConductDescription('');
    setSegundaPrefillNote(null);
    setSgdePreflight(null);
    setSgdeNodeIdHint(null);
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
      const dType = draft.caseFlowType;
      if (dType === 'tutela_primera' || dType === 'tutela_segunda' || dType === 'consulta_desacato') {
        setCaseFlowType(dType);
      } else if (draft.parsedData) {
        setCaseFlowType('tutela_primera');
      }
      if (typeof draft.originCourt === 'string') setOriginCourt(draft.originCourt);
      if (typeof draft.originRadicado === 'string') setOriginRadicado(draft.originRadicado);
      if (draft.appellantSel === 'accionante' || draft.appellantSel === 'accionado') {
        setAppellantSel(draft.appellantSel);
      }
      if (draft.originRulingSel === 'concedio' || draft.originRulingSel === 'nego') {
        setOriginRulingSel(draft.originRulingSel);
      }
      if (typeof draft.conductDescription === 'string') setConductDescription(draft.conductDescription);
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

  useEffect(() => {
    if (caseFlowType !== 'tutela_segunda') {
      setSegundaKnownRadicados([]);
      setSegundaSuffixLoading(false);
      return;
    }
    const base = cuiBase21(originRadicado);
    if (!base) {
      setSegundaKnownRadicados([]);
      setSegundaSuffixLoading(false);
      return;
    }
    let cancelled = false;
    setSegundaSuffixLoading(true);
    void (async () => {
      try {
        await ensureSupabaseSessionForWrites();
        const res = await supabase.from('cases').select('radicado').like('radicado', `${base}%`);
        if (cancelled) return;
        if (res.error) throw res.error;
        const list = (res.data ?? [])
          .map((row) => String(row.radicado || '').replace(/\D/g, ''))
          .filter((d) => d.length === 23 && d.startsWith(base));
        setSegundaKnownRadicados(list);
      } catch (e) {
        if (!cancelled) {
          console.warn('No se pudieron consultar radicados hermanos (segunda instancia)', e);
          setSegundaKnownRadicados([]);
        }
      } finally {
        if (!cancelled) setSegundaSuffixLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseFlowType, originRadicado]);

  useEffect(() => {
    if (caseFlowType === 'tutela_segunda') {
      setConsecutiveLoading(false);
    }
  }, [caseFlowType]);

  useEffect(() => {
    if (!parsedData || caseFlowType === 'tutela_segunda') return;
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
          .eq('court_id', courtId)
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
  }, [parsedData, courtId, caseFlowType]);

  useEffect(() => {
    if (!parsedData || radicationResult) return;
    try {
      localStorage.setItem(NEW_CASE_DRAFT_KEY, JSON.stringify({
        caseFlowType: caseFlowType ?? (parsedData ? 'tutela_primera' : null),
        originCourt,
        originRadicado,
        appellantSel,
        originRulingSel,
        conductDescription,
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
  }, [parsedData, radicationResult, attachments, parseSessionId, selectedDocIndex, selectedForMerge, aiAnalysis, consecutive, caseFlowType, originCourt, originRadicado, appellantSel, originRulingSel, conductDescription]);

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
    if (!caseFlowType) {
      setError('Seleccione primero el tipo de expediente (tarjeta superior).');
      return;
    }

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

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        [key: string]: unknown;
      };
      if (!response.ok) {
        throw new Error(data.error || `Error al parsear el archivo (${response.status})`);
      }
      setParsedData(data);
      setParseSessionId(typeof data.parseSessionId === 'string' ? data.parseSessionId : null);
      setAttachments(data.attachments || []);
      setSelectedDocIndex(-1);
      if (caseFlowType === 'tutela_segunda' || extractSegundaInstanciaFromParsedEmail(data).isSegundaInstancia) {
        applySegundaInstanciaPrefill(data, { forceFlowType: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsParsing(false);
    }
  };

  const derivedSegundaRadicado = useMemo(
    () =>
      caseFlowType === 'tutela_segunda'
        ? deriveRadicadoSegundaInstancia(originRadicado, segundaKnownRadicados)
        : null,
    [caseFlowType, originRadicado, segundaKnownRadicados]
  );

  const getFullRadicado = (cons: string) =>
    buildRadicadoPrimeraInstancia(cons, {
      cityCode: COURT_CONSTANTS.CITY_CODE,
      entityCode: COURT_CONSTANTS.ENTITY_CODE,
      specialtyCode: COURT_CONSTANTS.SPECIALTY_CODE,
      despachoCode: COURT_CONSTANTS.DESPACHO_CODE,
      instanceCode: COURT_CONSTANTS.INSTANCE_CODE,
    });

  const consecutiveNum = parseInt(consecutive.replace(/\D/g, ''), 10);
  const isSegundaFlow = caseFlowType === 'tutela_segunda';
  const consecutiveReady = isSegundaFlow
    ? !segundaSuffixLoading && Boolean(derivedSegundaRadicado)
    : !consecutiveLoading && consecutive.length > 0 && !Number.isNaN(consecutiveNum) && consecutiveNum >= 1;

  const handleRadicate = async () => {
    console.log("Iniciando radicación...");
    if (!parsedData) {
      console.error("No hay datos parseados");
      return;
    }
    if (!consecutiveReady) {
      setError(
        isSegundaFlow
          ? 'Indique el radicado de origen de 23 dígitos para derivar el CUI de segunda instancia.'
          : 'Espere el consecutivo sugerido o indique un número válido (1–99999).'
      );
      return;
    }

    const flow: CaseType = caseFlowType ?? 'tutela_primera';
    const notebookCode = notebookCodeForCaseType(flow);
    const originErr = validateCaseOriginForRadicate(
      flow,
      originCourt,
      originRadicado,
      appellantSel,
      originRulingSel,
      conductDescription,
    );
    if (!originErr && flow === 'tutela_segunda') {
      const originDigits = originRadicado.replace(/\D/g, '');
      if (originDigits.length === 23 && sgdePreflight?.status === 'no_encontrado') {
        setError(
          sgdePreflight.message ||
            'El expediente de origen no aparece en SGDE. Verifique el traslado digital antes de radicar.',
        );
        return;
      }
      if (originDigits.length === 23 && sgdePreflight?.status === 'sin_documentos') {
        setError(
          sgdePreflight.message ||
            'SGDE no muestra documentos en el expediente de origen. Espere el traslado o confirme en el portal.',
        );
        return;
      }
    }
    if (originErr) {
      setError(originErr);
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

      const radicadoFormatted =
        flow === 'tutela_segunda'
          ? (derivedSegundaRadicado as string)
          : getFullRadicado(consecutive.replace(/\D/g, '').padStart(5, '0'));
      console.log('Radicado generado:', radicadoFormatted);

      let dup;
      try {
        const res = await supabase
          .from('cases')
          .select('id')
          .eq('court_id', courtId)
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

      const { data: courtRow, error: courtFetchErr } = await supabase
        .from('courts')
        .select('sustanciador_assignment_mode, sustanciador_rr_cursor, sgde_auto_create_on_radicacion')
        .eq('id', courtId)
        .maybeSingle();
      if (courtFetchErr) throw courtFetchErr;
      const repartoMode = parseSustanciadorAssignmentMode(courtRow?.sustanciador_assignment_mode);
      const rrRaw = courtRow?.sustanciador_rr_cursor;
      const rrCursor =
        typeof rrRaw === 'number' && Number.isFinite(rrRaw)
          ? rrRaw
          : typeof rrRaw === 'string'
            ? Number.parseInt(rrRaw, 10) || 0
            : 0;
      const caseId = globalThis.crypto.randomUUID();
      const { assignedTo, nextRrCursor } = computeInitialAssignedTo({
        mode: repartoMode,
        radicado: radicadoFormatted,
        caseId,
        rrCursor,
      });

      const claimantNames = aiAnalysis ? joinPartyField(aiAnalysis.accionantes, 'nombre') : '';
      const defendantNames = aiAnalysis ? joinPartyField(aiAnalysis.accionados, 'nombre') : '';
      const derechoText = aiAnalysis?.derechoTutelado || '';
      const guessedDerecho = guessDerechoTuteladoCodeFromText(derechoText);
      const filingForTerm = startOfLocalDay(new Date());
      const deadlineAtIso = tenthBusinessDayDeadline(filingForTerm).toISOString();
      const caseRow: Record<string, unknown> = {
        id: caseId,
        court_id: courtId,
        radicado: radicadoFormatted,
        deadline_at: deadlineAtIso,
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
        legal_derecho_tutelado: derechoText,
        derecho_tutelado_code: guessedDerecho ?? null,
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
      if (assignedTo) caseRow.assigned_to = assignedTo;

      caseRow.case_type = flow;
      if (flow === 'tutela_primera') {
        caseRow.origin_court = null;
        caseRow.origin_radicado = null;
        caseRow.appellant = null;
        caseRow.origin_ruling = null;
        caseRow.conduct_description = null;
      } else if (flow === 'tutela_segunda') {
        caseRow.origin_court = originCourt.trim();
        caseRow.origin_radicado = originRadicado.trim();
        caseRow.appellant = appellantSel;
        caseRow.origin_ruling = originRulingSel;
        caseRow.conduct_description = null;
      } else {
        caseRow.origin_court = originCourt.trim();
        caseRow.origin_radicado = originRadicado.trim();
        caseRow.appellant = null;
        caseRow.origin_ruling = null;
        caseRow.conduct_description = conductDescription.trim();
      }

      const caseRowForDb = deepSanitizeForPostgresInsert(caseRow) as Record<string, unknown>;

      try {
        const ins = await supabase.from('cases').insert(caseRowForDb).select('id').single();
        if (ins.error) throw ins.error;
      } catch (e) {
        await handleDataPermissionError(e, 'create', 'cases');
        throw e;
      }
      console.log('Caso creado con ID:', caseId);

      try {
        await openRadicacionStageAfterRadicate(supabase, {
          caseId,
          courtId,
          radicado: radicadoFormatted,
          caseType: flow,
          caseAssignedTo: assignedTo ?? null,
        });
      } catch (e) {
        console.error('Etapas iniciales (RADICACION):', e);
      }

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
          notebook_code: notebookCode,
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
              notebook_code: notebookCode,
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
              notebook_code: notebookCode,
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
            notebook_code: notebookCode,
          });
        }
      }

      const docRowsForDb = docRows.map((r) => deepSanitizeForPostgresInsert(r) as Record<string, unknown>);
      const { error: docErr } = await insertCaseDocumentRows(supabase, docRowsForDb);
      if (docErr) {
        await handleDataPermissionError(docErr, 'create', 'case_documents');
        await removeCaseDocumentObjects(supabase, uploadedStoragePaths);
        const { error: delErr } = await supabase.from('cases').delete().eq('id', caseId);
        if (delErr) console.error('No se pudo revertir el expediente tras fallo en anexos:', delErr);
        throw docErr;
      }

      if (flow === 'tutela_primera' && courtRow?.sgde_auto_create_on_radicacion !== false) {
        try {
          const sgdeRes = await sgdeCreateExpediente({ caseId, uploadDocuments: true });
          const { data: u } = await supabase.auth.getUser();
          const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
          const sgdeAct = deepSanitizeForPostgresInsert({
            case_id: caseId,
            type: 'sgde_create',
            description: sgdeRes.message || 'Expediente creado o enlazado en SGDE.',
            user_id: u.user?.id ?? null,
            user_name: String(uname),
            metadata: {
              sgde_root_id: sgdeRes.sgdeRootId,
              ya_existe: sgdeRes.yaExiste ?? false,
              uploaded: sgdeRes.uploaded,
              upload_failed: sgdeRes.uploadFailed,
            },
          });
          const { error: sgdeActErr } = await supabase.from('case_actions').insert(sgdeAct);
          if (sgdeActErr) console.error('Actuación SGDE create:', sgdeActErr);
          try {
            const syncRes = await sgdeSyncDocuments({ caseId, uploadMissing: true });
            const syncAct = deepSanitizeForPostgresInsert({
              case_id: caseId,
              type: 'sgde_sync',
              description: syncRes.message || 'Sincronización documental con SGDE.',
              user_id: u.user?.id ?? null,
              user_name: String(uname),
              metadata: {
                linked: syncRes.linked,
                local_only: syncRes.localOnly,
                sgde_only: syncRes.sgdeOnly,
                uploaded: syncRes.uploaded,
              },
            });
            await supabase.from('case_actions').insert(syncAct);
          } catch (syncErr) {
            console.error('Sync SGDE tras radicación:', syncErr);
          }
        } catch (sgdeErr) {
          console.error('Creación SGDE tras radicación:', sgdeErr);
          try {
            await supabase
              .from('cases')
              .update({ sgde_sync_status: 'error', updated_at: new Date().toISOString() })
              .eq('id', caseId);
          } catch {
            /* columna sgde_sync_status puede no existir aún */
          }
        }
      }

      if (flow === 'tutela_segunda') {
        const originDigits = originRadicado.replace(/\D/g, '');
        if (
          originDigits.length === 23 &&
          sgdePreflight &&
          (sgdePreflight.status === 'listo' || sgdePreflight.status === 'incompleto') &&
          sgdePreflight.pdfCount > 0
        ) {
          try {
            const mig = await sgdeMigrateOriginToCase({
              caseId,
              originRadicado: originDigits,
              sgdeRootId: sgdePreflight.sgdeRootId,
              sgdeNodeIdHint: sgdeNodeIdHint || sgdePreflight.sgdeRootId,
              notebookCode: NOTEBOOK_SI_C01_PRINCIPAL,
            });
            if (mig.migrated > 0) {
              const { data: u } = await supabase.auth.getUser();
              const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
              const migRow = deepSanitizeForPostgresInsert({
                case_id: caseId,
                type: 'sgde_migrate',
                description: `Migrados ${mig.migrated} PDF desde SGDE (origen ${originDigits}).`,
                user_id: u.user?.id ?? null,
                user_name: String(uname),
                metadata: {
                  origin_radicado: originDigits,
                  sgde_root_id: mig.sgdeRootId,
                  migrated: mig.migrated,
                  failed: mig.failed,
                },
              });
              const { error: migActErr } = await supabase.from('case_actions').insert(migRow);
              if (migActErr) console.error('Actuación migración SGDE:', migActErr);
            }
            if (mig.failed > 0) {
              console.warn('SGDE migrate partial failures:', mig.errors);
            }
          } catch (migErr) {
            console.error('Migración SGDE tras radicación:', migErr);
          }
        }
      }

      if (repartoMode === 'alternating') {
        const { error: rrUpErr } = await supabase
          .from('courts')
          .update({
            sustanciador_rr_cursor: nextRrCursor,
            updated_at: new Date().toISOString(),
          })
          .eq('id', courtId);
        if (rrUpErr) console.error('No se pudo actualizar el cursor de reparto alternado:', rrUpErr);
      }

      if (assignedTo) {
        const { data: u } = await supabase.auth.getUser();
        const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
        const actionRow = deepSanitizeForPostgresInsert({
          case_id: caseId,
          type: 'assignment',
          description: `Asignación inicial (${SUSTANCIADOR_ASSIGNMENT_MODE_AUDIT[repartoMode]}): ${assignedTo}`,
          user_id: u.user?.id ?? null,
          user_name: String(uname),
          metadata: {
            kind: 'initial_radicacion',
            mode: repartoMode,
            radicado: radicadoFormatted,
            assigned_to: assignedTo,
          },
        });
        const { error: actErr } = await supabase.from('case_actions').insert(actionRow);
        if (actErr) console.error('No se pudo registrar la asignación inicial en actuaciones:', actErr);
        await insertAssignmentNotificationsForProfiles(supabase, {
          courtId,
          caseId,
          radicado: radicadoFormatted,
          assignedTo,
          actorUserName: String(uname),
        });
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
    // Mantener ambos alineados: el expediente y el visor priorizan `name` y usan
    // `originalName` como respaldo; duplicar evita borradores incoherentes.
    newAttachments[idx].originalName = editingName;
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

      {!caseFlowType ? (
        <CaseTypeSelector
          error={error}
          onSelectCaseType={setCaseFlowType}
          onClearError={() => setError(null)}
        />
      ) : !parsedData ? (
        <CaseEmailParser
          caseFlowType={caseFlowType}
          onChangeCaseFlowType={() => {
            setCaseFlowType(null);
            setFile(null);
            setError(null);
          }}
          originFields={
            <>
              <NewCaseOriginFlowFields
                caseFlowType={caseFlowType}
                originCourt={originCourt}
                setOriginCourt={setOriginCourt}
                originRadicado={originRadicado}
                setOriginRadicado={setOriginRadicado}
                appellantSel={appellantSel}
                setAppellantSel={setAppellantSel}
                originRulingSel={originRulingSel}
                setOriginRulingSel={setOriginRulingSel}
                conductDescription={conductDescription}
                setConductDescription={setConductDescription}
              />
              {caseFlowType === 'tutela_segunda' ? (
                <CaseSgdeSegundaPreflightPanel
                  originRadicado={originRadicado}
                  sgdeNodeIdHint={sgdeNodeIdHint}
                  onPreflightChange={setSgdePreflight}
                />
              ) : null}
            </>
          }
          file={file}
          onFileInputChange={handleFileChange}
          onDrop={onDrop}
          onParseEmail={parseEmail}
          isParsing={isParsing}
          error={error}
        />
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

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs font-semibold text-slate-700">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                Tipo de expediente
              </span>
              <span aria-hidden className="mr-1.5">
                {CASE_TYPE_CARD_COPY[caseFlowType ?? 'tutela_primera'].emoji}
              </span>
              {CASE_TYPE_CARD_COPY[caseFlowType ?? 'tutela_primera'].title} —{' '}
              {CASE_TYPE_CARD_COPY[caseFlowType ?? 'tutela_primera'].subtitle}
            </div>

            <NewCaseOriginFlowFields
              caseFlowType={caseFlowType ?? 'tutela_primera'}
              originCourt={originCourt}
              setOriginCourt={setOriginCourt}
              originRadicado={originRadicado}
              setOriginRadicado={setOriginRadicado}
              appellantSel={appellantSel}
              setAppellantSel={setAppellantSel}
              originRulingSel={originRulingSel}
              setOriginRulingSel={setOriginRulingSel}
              conductDescription={conductDescription}
              setConductDescription={setConductDescription}
            />

            {segundaPrefillNote ? (
              <p className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-2.5 text-xs font-medium text-violet-900">
                {segundaPrefillNote}
              </p>
            ) : null}

            {caseFlowType === 'tutela_segunda' ? (
              <CaseSgdeSegundaPreflightPanel
                originRadicado={originRadicado}
                sgdeNodeIdHint={sgdeNodeIdHint}
                disabled={isRadicating}
                onPreflightChange={setSgdePreflight}
              />
            ) : null}

            <CaseRadicacionConsecutivePanel
              consecutive={consecutive}
              setConsecutive={setConsecutive}
              consecutiveLoading={consecutiveLoading}
              consecutiveReady={consecutiveReady}
              radicadoConflict={radicadoConflict}
              segundaInstancia={
                caseFlowType === 'tutela_segunda'
                  ? {
                      originRadicado,
                      derivedRadicado: derivedSegundaRadicado,
                      suffixLoading: segundaSuffixLoading,
                      knownRadicados: segundaKnownRadicados,
                    }
                  : undefined
              }
            />
          </div>

          {/* AI Analysis (Full Width) */}
          <CaseLegalAnalysisPanel
            section="ai"
            aiAnalysis={aiAnalysis}
            onDismissAnalysis={() => setAiAnalysis(null)}
          />

          {/* Main Grid: Actions & Viewer */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <CaseRadicacionActions
              aiAnalysis={aiAnalysis}
              isRadicating={isRadicating}
              consecutiveReady={consecutiveReady}
              error={error}
              onRadicate={handleRadicate}
            />

            <CaseLegalAnalysisPanel
              section="metadata"
              parsedData={parsedData}
              attachments={attachments}
              selectedDocIndex={selectedDocIndex}
              onSelectDocIndex={setSelectedDocIndex}
              mergeSelected={mergeSelected}
              isMerging={isMerging}
              selectedForMerge={selectedForMerge}
              toggleSelectForMerge={toggleSelectForMerge}
              editingIndex={editingIndex}
              setEditingIndex={setEditingIndex}
              editingName={editingName}
              setEditingName={setEditingName}
              handleRename={handleRename}
              handleMove={handleMove}
            />
          </div>

          {/* Viewer Section */}
          <div className="lg:col-span-7 card-modern overflow-hidden bg-white flex flex-col h-[750px] min-w-0">
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
                   <CasePdfViewer
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
