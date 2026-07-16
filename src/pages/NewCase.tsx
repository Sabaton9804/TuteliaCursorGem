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
import { apiAuthHeaders, ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import { getSupabaseAuthErrorMessage } from '../lib/supabase-auth-errors';
import { handleDataPermissionError } from '../lib/error-handler';
import { motion } from 'motion/react';
import { PDFDocument } from 'pdf-lib';
import { CUI_INSTANCE_PRIMERA } from '../lib/radicado-cui';
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
import {
  sgdeCreateExpediente,
  sgdeMigrateOriginToCase,
  sgdePublishSegundaImpugnacion,
  sgdeSyncDocuments,
  type SgdePreflightResult,
} from '../lib/sgde-api';
import {
  extractSegundaInstanciaFromParsedEmail,
  shouldTriggerSgdeAfterEmailParse,
  shouldUseSegundaInstanciaFlow,
} from '../lib/segunda-instancia-email';
import { CaseSgdeSegundaPreflightPanel } from '../components/new-case/CaseSgdeSegundaPreflightPanel';
import { fetchParseSessionAttachment, uint8ArrayToBase64 } from '../lib/parse-session-attachment';
import { filesToNewCaseAttachments } from '../lib/new-case-attachment';
import {
  buildEmailAsAttachment,
  emailBodyToPdfBytes,
  isEmailBodyAttachment,
  isMergeableAttachment,
} from '../lib/new-case-email-attachment';
import { NEW_CASE_FRESH_EVENT, NEW_CASE_FRESH_NAV_FLAG } from '../lib/new-case-nav';
import {
  guessDerechoTuteladoCodeFromText,
} from '../lib/sierju-case-codes';
import type { DerechoTuteladoCode } from '../lib/sierju-case-codes';
import { mapTuteliaCaseTypeToLegalAnalysisKind } from '../lib/legal-analysis-case-kind';
import {
  buildSierjuClassificationPatch,
  fetchSierjuClassesForCaseType,
} from '../lib/sierju-catalog-service';
import { CaseSierjuClassification } from '../components/expediente/CaseSierjuClassification';
import { startOfLocalDay } from '../lib/business-days';
import { caseTermBusinessDaysFromDecreto2591 } from '../lib/decreto-2591-plazos';
import {
  computePlazoFallarDeadlineAt,
  shouldSetPlazoFallarAtRadicacion,
} from '../lib/plazo-fallar-tutela';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import {
  useCourtOperational,
  radicacionCourtPrefixFromConfig,
  buildRadicacionYearPrefix,
} from '../contexts/CourtOperationalContext';
import { resolveProcessDefinitionId } from '../lib/process-definitions-service';
import { assertRadicacionProfileAccess } from '../lib/radicacion-profile-access';
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
import {
  isKnownRadicableCaseType,
  validateCaseOriginForRadicate,
} from '../hooks/useNewCaseForm';
import { CaseEmailParser } from '../components/new-case/CaseEmailParser';
import { CaseTypeInferredBanner } from '../components/new-case/CaseTypeInferredBanner';
import { mapTipoProcesoToCivilCaseType } from '../lib/case-process-scope';
import { inferCaseTypeFromParsedEmail } from '../lib/infer-case-type-from-email';
import { isCivilCaseType } from '../lib/process-product-scope';
import {
  findSierjuTipoByCode,
  matchSierjuTipoFromText,
  SIERJU_CIVIL_ACTIVE_SECTION,
} from '../lib/sierju-process-tipos';
import { CaseFormSegundaInstancia } from '../components/new-case/CaseFormSegundaInstancia';
import { CaseFormConsultaDesacato } from '../components/new-case/CaseFormConsultaDesacato';
import { CasePdfViewer } from '../components/new-case/CasePdfViewer';
import { CaseEmailHtmlPreview } from '../components/new-case/CaseEmailHtmlPreview';
import { CaseLegalAnalysisPanel } from '../components/new-case/CaseLegalAnalysisPanel';

const NEW_CASE_DRAFT_KEY = 'tutelia_new_case_draft';
const AI_ANALYSIS_CACHE_KEY = 'tutelia_ai_analysis_cache_v4';

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

/** Inferencia ligera de tipo cuando el flujo parte sin grilla (canal único + IA). */
function inferCaseTypeFromAnalysisCorpus(
  corpus: string,
  current: CaseType | null,
): CaseType | null {
  const t = corpus.toLowerCase();
  if (!t.trim()) return null;
  if (/consulta\s+(de\s+)?(incidente\s+de\s+)?desacato/.test(t)) return 'consulta_desacato';
  if (
    (current === null || current === 'tutela_primera') &&
    /impugnaci[oó]n/.test(t) &&
    (/segunda\s+instancia|juzgado\s+.*remit|fallo\s+de\s+primera/.test(t) || /tutela/.test(t))
  ) {
    return 'tutela_segunda';
  }
  if (/proceso\s+ejecutivo|demanda\s+ejecutiva|juicio\s+ejecutivo/.test(t)) {
    return 'civil_ejecutivo';
  }
  if (/jurisdicci[oó]n\s+voluntaria/.test(t)) return 'civil_jurisdiccion_voluntaria';
  if (/\binsolvencia\b/.test(t)) return 'civil_insolvencia';
  if (
    /demanda\s+ordinaria|proceso\s+ordinario\s+civil|proceso\s+civil|c[oó]digo\s+general\s+del\s+proceso/.test(
      t,
    ) &&
    !/tutela|derecho\s+fundamental/.test(t)
  ) {
    return mapTipoProcesoToCivilCaseType(t);
  }
  return null;
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
  let message = String(err?.message || '');
  let code = String(err?.code || '').toLowerCase();
  try {
    const parsed = JSON.parse(message) as { error?: string; code?: string };
    if (typeof parsed.error === 'string' && parsed.error.trim()) message = parsed.error;
    if (typeof parsed.code === 'string') code = parsed.code.toLowerCase();
  } catch {
    /* mensaje plano */
  }
  const rawMessage = message.toLowerCase();

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
    return (
      'Su usuario no tiene permisos en la base de datos (RLS). Compruebe que exista su fila en public.profiles ' +
      'con el mismo court_id que su despacho (p. ej. court-1), que haya iniciado sesión en Tutelia (no solo modo local) ' +
      'y que en Supabase esté aplicada la migración supabase/migrations/20260518120000_core_tables_rls_by_court.sql ' +
      'o que las políticas de cases permitan INSERT a su perfil.'
    );
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

  if (
    code === '23505' ||
    rawMessage.includes('duplicate key') ||
    rawMessage.includes('unique constraint') ||
    rawMessage.includes('cases_court_id_radicado')
  ) {
    return 'Ya existe un expediente con ese radicado en este despacho. Verifique el consecutivo o consulte la lista de expedientes.';
  }

  return message || 'Error desconocido al radicar expediente.';
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
  // Primera instancia (tutela o civil): no hay juzgado remitente ni consulta de desacato.
  if (caseFlowType === 'tutela_primera' || isCivilCaseType(caseFlowType)) return null;
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
  if (caseFlowType === 'consulta_desacato') {
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
  return null;
}

export default function NewCase() {
  const { courtId, profile: sessionProfile } = useSessionCourt();
  const { radicacion, sustanciadores, processForCaseType, instanceCodeForCaseType } = useCourtOperational();
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [parseSessionId, setParseSessionId] = useState<string | null>(null);
  const [archiveLinkStatus, setArchiveLinkStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>(
    'idle',
  );
  const [archiveLinkError, setArchiveLinkError] = useState<string | null>(null);
  const [selectedDocIndex, setSelectedDocIndex] = useState<number>(0);
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [isAddingAttachments, setIsAddingAttachments] = useState(false);
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
  const [sierjuDerechoSel, setSierjuDerechoSel] = useState<DerechoTuteladoCode | undefined>();
  const [sierjuClassIdSel, setSierjuClassIdSel] = useState<string | undefined>();
  /** Código fila SIERJU TIPOS PROCESOS Civil-Oral (p. ej. ejecutivos). */
  const [sierjuTipoCode, setSierjuTipoCode] = useState<string | undefined>();

  const applySierjuTipoSelection = useCallback(
    async (
      codeOrLabel: string,
      opts?: {
        caseType?: CaseType;
        note?: string;
      },
    ) => {
      const hit = findSierjuTipoByCode(codeOrLabel) || matchSierjuTipoFromText(codeOrLabel);
      const flow = opts?.caseType ?? hit?.caseType ?? 'civil_ordinario';
      setCaseFlowType(flow);
      if (hit) {
        setSierjuTipoCode(hit.code);
        setSegundaPrefillNote(
          opts?.note ?? `Tipo SIERJU Civil-Oral: ${hit.label}.`,
        );
        try {
          const classes = await fetchSierjuClassesForCaseType(courtId, flow);
          const byCode =
            classes.find((c) => c.code === hit.code && c.sectionCode === SIERJU_CIVIL_ACTIVE_SECTION) ||
            classes.find((c) => c.code === hit.code && String(c.sectionCode || '').includes('oral')) ||
            classes.find((c) => c.code === hit.code);
          if (byCode) {
            setSierjuClassIdSel(byCode.id);
            setSierjuDerechoSel(byCode.derechoTuteladoCode);
          }
        } catch {
          /* catálogo remoto opcional */
        }
      } else if (isCivilCaseType(flow)) {
        setSierjuTipoCode(undefined);
      }
    },
    [courtId],
  );
  const navigate = useNavigate();
  const location = useLocation();

  const applySegundaFieldsExtract = useCallback(
    (extract: { appellant?: string | null; originRuling?: string | null } | null) => {
      if (!extract) return;
      if (extract.appellant === 'accionante' || extract.appellant === 'accionado') {
        setAppellantSel(extract.appellant);
      }
      if (extract.originRuling === 'concedio' || extract.originRuling === 'nego') {
        setOriginRulingSel(extract.originRuling);
      }
    },
    []
  );

  const segundaEmailDigest = useMemo(() => {
    if (!parsedData) return null;
    const subject = String((parsedData as { subject?: unknown }).subject || '');
    const text =
      typeof (parsedData as { text?: unknown }).text === 'string'
        ? (parsedData as { text: string }).text
        : '';
    const html =
      typeof (parsedData as { html?: unknown }).html === 'string'
        ? (parsedData as { html: string }).html
        : '';
    const combined = `${subject}\n${text}\n${html}`.trim();
    return combined.length > 0 ? combined.slice(0, 120_000) : null;
  }, [parsedData]);

  const caseFlowTypeRef = useRef(caseFlowType);
  caseFlowTypeRef.current = caseFlowType;

  const applySegundaInstanciaPrefill = useCallback(
    (parsed: Record<string, unknown>, opts?: { forceFlowType?: boolean }) => {
      const si = extractSegundaInstanciaFromParsedEmail(parsed);
      const currentFlow = caseFlowTypeRef.current;
      const userChoseSegunda = opts?.forceFlowType || currentFlow === 'tutela_segunda';
      const autoSegunda = shouldUseSegundaInstanciaFlow(si);
      if (!userChoseSegunda && !autoSegunda) return false;

      if (autoSegunda || opts?.forceFlowType || !currentFlow) {
        setCaseFlowType('tutela_segunda');
      }
      if (si.originRadicado) setOriginRadicado(si.originRadicado);
      if (si.originCourt) setOriginCourt(si.originCourt);
      if (si.sgdeNodeId) setSgdeNodeIdHint(si.sgdeNodeId);
      applySegundaFieldsExtract(si);

      if (autoSegunda && si.originRadicado) {
        setSegundaPrefillNote(
          `Origen detectado en el correo: ${si.originCourt || 'juzgado en SGDE'} · CUI ${si.originRadicado}` +
            (si.repartoSecuencia ? ` · Reparto ${si.repartoSecuencia}` : '')
        );
      } else if (si.originRadicado) {
        setSegundaPrefillNote(
          `CUI ${si.originRadicado} extraído del correo (p. ej. traslado). Revise en SGDE y confirme que es el radicado de origen de 23 dígitos.`
        );
      } else {
        setSegundaPrefillNote(null);
      }
      return Boolean(si.originRadicado || si.originCourt || si.sgdeNodeId);
    },
    [applySegundaFieldsExtract]
  );

  // Solo al cambiar el correo parseado (no en cada cambio de caseFlowType → evita bucles).
  useEffect(() => {
    if (!parsedData) return;
    applySegundaInstanciaPrefill(parsedData as Record<string, unknown>);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intencional: una sola pasada por parsedData
  }, [parsedData]);

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
      sessionStorage.removeItem('tutelia_outlook_radicacion');
      setParsedData(data);
      setParseSessionId(typeof data.parseSessionId === 'string' ? data.parseSessionId : null);
      const outlookAtt = Array.isArray(data.attachments) ? data.attachments : [];
      const hasEmail = outlookAtt.some((a) => isEmailBodyAttachment(a as { type?: string }));
      setAttachments(hasEmail ? outlookAtt : [buildEmailAsAttachment(data), ...outlookAtt]);
      setSelectedDocIndex(0);
      setError(null);
      applySegundaInstanciaPrefill(data, { forceFlowType: true });
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
    setSelectedDocIndex(0);
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
    setSierjuDerechoSel(undefined);
    setSierjuClassIdSel(undefined);
    setSierjuTipoCode(undefined);
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
      // Borradores antiguos con PDFs en base64 congelan el hilo al parsear.
      if (raw.length > 1_500_000) {
        localStorage.removeItem(NEW_CASE_DRAFT_KEY);
        return;
      }
      const draft = JSON.parse(raw);
      const dType = draft.caseFlowType;
      if (isKnownRadicableCaseType(dType)) {
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
      if (Array.isArray(draft.attachments)) {
        const draftAtt = draft.attachments as Array<{ type?: string }>;
        const hasEmail = draftAtt.some((a) => isEmailBodyAttachment(a));
        setAttachments(
          hasEmail
            ? draft.attachments
            : [buildEmailAsAttachment(draft.parsedData || {}), ...draft.attachments]
        );
      }
      setParseSessionId(typeof draft.parseSessionId === 'string' ? draft.parseSessionId : null);
      if (typeof draft.selectedDocIndex === 'number') {
        setSelectedDocIndex(draft.selectedDocIndex < 0 ? 0 : draft.selectedDocIndex);
      }
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
        const prefix = buildRadicacionYearPrefix(radicacion, Number(year));
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
  }, [parsedData, courtId, caseFlowType, radicacion]);

  useEffect(() => {
    if (!parsedData || radicationResult) return;
    try {
      // Nunca persistir content/base64 de adjuntos: congelaba Chrome al JSON.stringify
      // de PDFs grandes y al restaurar el borrador.
      const lightAttachments = (Array.isArray(attachments) ? attachments : []).map((a) => {
        const row = a as Record<string, unknown>;
        const { content: _omit, ...rest } = row;
        return {
          ...rest,
          hasContent: typeof row.content === 'string' && row.content.length > 0,
        };
      });
      const lightParsed = (() => {
        if (!parsedData || typeof parsedData !== 'object') return parsedData;
        const p = { ...(parsedData as Record<string, unknown>) };
        if (Array.isArray(p.attachments)) {
          p.attachments = (p.attachments as Record<string, unknown>[]).map((att) => {
            const { content: _c, ...r } = att;
            return r;
          });
        }
        if (typeof p.html === 'string' && p.html.length > 20_000) {
          p.html = `${p.html.slice(0, 20_000)}…`;
        }
        if (typeof p.text === 'string' && p.text.length > 20_000) {
          p.text = `${p.text.slice(0, 20_000)}…`;
        }
        return p;
      })();
      const payload = JSON.stringify({
        caseFlowType: caseFlowType ?? (parsedData ? 'tutela_primera' : null),
        originCourt,
        originRadicado,
        appellantSel,
        originRulingSel,
        conductDescription,
        parsedData: lightParsed,
        attachments: lightAttachments,
        parseSessionId,
        selectedDocIndex,
        selectedForMerge,
        aiAnalysis,
        consecutive,
      });
      if (payload.length > 1_500_000) {
        localStorage.removeItem(NEW_CASE_DRAFT_KEY);
        return;
      }
      localStorage.setItem(NEW_CASE_DRAFT_KEY, payload);
    } catch (e) {
      console.error('No se pudo guardar borrador local de radicacion', e);
      try {
        localStorage.removeItem(NEW_CASE_DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [parsedData, radicationResult, attachments, parseSessionId, selectedDocIndex, selectedForMerge, aiAnalysis, consecutive, caseFlowType, originCourt, originRadicado, appellantSel, originRulingSel, conductDescription]);

  useEffect(() => {
    if (!radicationResult) return;
    const t = window.setTimeout(() => {
      navigate(`/case/${radicationResult.caseId}`);
    }, 2800);
    return () => window.clearTimeout(t);
  }, [radicationResult, navigate]);

  useEffect(() => {
    const text = aiAnalysis?.derechoTutelado || '';
    if (!text.trim()) return;
    if (isCivilCaseType(caseFlowType)) {
      const sierjuHit = matchSierjuTipoFromText(text);
      if (sierjuHit) {
        void applySierjuTipoSelection(sierjuHit.code, {
          caseType: sierjuHit.caseType,
          note: `Tipo SIERJU por IA: ${sierjuHit.label}.`,
        });
      }
      return;
    }
    if (
      caseFlowType === 'tutela_primera' ||
      caseFlowType === 'tutela_segunda' ||
      caseFlowType === 'consulta_desacato'
    ) {
      const guessed = guessDerechoTuteladoCodeFromText(text);
      if (guessed) {
        setSierjuDerechoSel(guessed);
        setSierjuClassIdSel(undefined);
      }
    }
  }, [aiAnalysis?.derechoTutelado, applySierjuTipoSelection, caseFlowType]);

  const clearSgdeOriginState = useCallback(() => {
    setOriginRadicado('');
    setOriginCourt('');
    setSgdePreflight(null);
    setSgdeNodeIdHint(null);
    setSegundaPrefillNote(null);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      clearSgdeOriginState();
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      clearSgdeOriginState();
    }
  }, [clearSgdeOriginState]);

  const fetchArchiveFromParseSession = async (sid: string, linkUrl?: string | null) => {
    setArchiveLinkStatus('loading');
    setArchiveLinkError(null);
    try {
      const auth = await apiAuthHeaders({ json: true });
      const res = await fetch(`/api/parse-session/${encodeURIComponent(sid)}/fetch-archive`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(linkUrl ? { url: linkUrl } : {}),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        attachments?: unknown[];
      };
      if (!res.ok) {
        throw new Error(payload.error || `No se pudo descargar el enlace (${res.status})`);
      }
      const raw = Array.isArray(payload.attachments) ? payload.attachments : [];
      setAttachments((prev) => {
        const emailAtt = prev.find((a) => a?.type === 'email_body') ?? null;
        return emailAtt ? [emailAtt, ...raw] : [...raw];
      });
      setArchiveLinkStatus('ok');
    } catch (err) {
      setArchiveLinkStatus('error');
      setArchiveLinkError(err instanceof Error ? err.message : 'Error al descargar el enlace Archivo');
    }
  };

  const parseEmail = async () => {
    if (!file) return;

    setIsParsing(true);
    setError(null);
    setRadicationResult(null);
    setParseSessionId(null);
    setArchiveLinkStatus('idle');
    setArchiveLinkError(null);
    clearSgdeOriginState();

    const formData = new FormData();
    formData.append('email', file);

    try {
      const auth = await apiAuthHeaders({ json: false });
      const response = await fetch('/api/parse-email', {
        method: 'POST',
        headers: auth,
        body: formData,
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        [key: string]: unknown;
      };
      if (!response.ok) {
        const base = data.error || `Error al parsear el archivo (${response.status})`;
        if (response.status === 401) {
          throw new Error(
            `${base} Cierre sesión e ingrese de nuevo para renovar el token.`,
          );
        }
        throw new Error(base);
      }
      setParsedData(data);
      const sid = typeof data.parseSessionId === 'string' ? data.parseSessionId : null;
      setParseSessionId(sid);
      const rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
      // El visor y la radicación cargan bytes bajo demanda (sessionIndex); no bloquear el spinner
      // descargando todos los PDF a base64 aquí (congelaba “Procesando…” varios minutos).
      setAttachments([buildEmailAsAttachment(data, file?.name), ...rawAttachments]);
      setSelectedDocIndex(0);
      const linkUrl = typeof data.linkUrl === 'string' ? data.linkUrl : null;
      const linkPending = data.linkPending === true || (data.linkFound === true && !!linkUrl);
      if (sid && linkPending) {
        // No await: el parseo termina; la demanda del portal (~50 MB / ~30 s) sigue en segundo plano.
        void fetchArchiveFromParseSession(sid, linkUrl);
      }
      const parsedEmail = data as {
        subject?: unknown;
        from?: unknown;
        to?: unknown;
        text?: unknown;
        html?: unknown;
        segundaInstancia?: unknown;
      };
      const si = extractSegundaInstanciaFromParsedEmail(parsedEmail);
      if (shouldTriggerSgdeAfterEmailParse(si) || shouldUseSegundaInstanciaFlow(si)) {
        applySegundaInstanciaPrefill(parsedEmail, { forceFlowType: true });
      } else if (caseFlowType === 'tutela_segunda') {
        applySegundaInstanciaPrefill(parsedEmail, { forceFlowType: true });
      } else if (!caseFlowType) {
        const inferred = inferCaseTypeFromParsedEmail({
          subject: typeof parsedEmail.subject === 'string' ? parsedEmail.subject : null,
          from: typeof parsedEmail.from === 'string' ? parsedEmail.from : null,
          to: typeof parsedEmail.to === 'string' ? parsedEmail.to : null,
          text: typeof parsedEmail.text === 'string' ? parsedEmail.text : null,
          html: typeof parsedEmail.html === 'string' ? parsedEmail.html : null,
        });
        if (inferred) {
          if (inferred.startsWith('civil_')) {
            const corpus = [
              typeof parsedEmail.subject === 'string' ? parsedEmail.subject : '',
              typeof parsedEmail.text === 'string' ? parsedEmail.text : '',
              typeof parsedEmail.html === 'string' ? parsedEmail.html : '',
            ].join('\n');
            const sierjuHit =
              matchSierjuTipoFromText(corpus) || findSierjuTipoByCode('otros_procesos');
            void applySierjuTipoSelection(sierjuHit?.code || 'otros_procesos', {
              caseType: inferred,
              note: sierjuHit
                ? `Correo de radicación civil. Tipo SIERJU Civil-Oral provisional: ${sierjuHit.label}. Confirme con la demanda o la IA.`
                : `Tipo detectado: proceso civil. Seleccione la fila SIERJU Civil-Oral antes de radicar.`,
            });
          } else {
            setCaseFlowType(inferred);
            setSierjuTipoCode(undefined);
            setSegundaPrefillNote(
              `Tipo detectado por el correo: ${inferred}. Puede corregirlo manualmente si aplica.`,
            );
          }
        } else {
          // Canal único: fallback tutela solo si el correo no tipifica (civil, desacato, etc.).
          setCaseFlowType('tutela_primera');
          setSierjuTipoCode(undefined);
          setSegundaPrefillNote(
            'Tipo provisional: tutela de primera instancia. Se ajustará con el análisis IA o si corrige el tipo.',
          );
        }
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

  const getFullRadicado = (cons: string) => {
    const flow = caseFlowType ?? 'tutela_primera';
    return buildRadicadoPrimeraInstancia(
      cons,
      radicacionCourtPrefixFromConfig(radicacion, instanceCodeForCaseType(flow)),
    );
  };

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

      await assertRadicacionProfileAccess(supabase, authAfter.user.id, courtId, sessionProfile);

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
        sustanciadores,
      });

      const processDef = processForCaseType(flow);
      const processDefinitionId =
        processDef?.id ?? (await resolveProcessDefinitionId(flow, courtId));

      const claimantNames = aiAnalysis ? joinPartyField(aiAnalysis.accionantes, 'nombre') : '';
      const defendantNames = aiAnalysis ? joinPartyField(aiAnalysis.accionados, 'nombre') : '';
      const derechoText = aiAnalysis?.derechoTutelado || '';
      const guessedDerecho = guessDerechoTuteladoCodeFromText(derechoText);
      const effectiveDerecho = sierjuDerechoSel ?? guessedDerecho;
      const sierjuClasses = await fetchSierjuClassesForCaseType(courtId, flow);
      const sierjuPatch = buildSierjuClassificationPatch(sierjuClasses, {
        derechoCode: effectiveDerecho ?? null,
        classId: sierjuClassIdSel ?? null,
      });
      const filingForTerm = startOfLocalDay(new Date());
      let deadlineAtIso: string | null = null;
      if (shouldSetPlazoFallarAtRadicacion(flow)) {
        const termDays =
          processDef?.case_term_type === 'habiles' && processDef.case_term_days != null && processDef.case_term_days > 0
            ? processDef.case_term_days
            : caseTermBusinessDaysFromDecreto2591(flow);
        if (termDays != null) {
          deadlineAtIso = computePlazoFallarDeadlineAt(flow, filingForTerm);
        }
      }
      const caseRow: Record<string, unknown> = {
        id: caseId,
        court_id: courtId,
        radicado: radicadoFormatted,
        ...(deadlineAtIso ? { deadline_at: deadlineAtIso } : {}),
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
        derecho_tutelado_code: sierjuPatch.derecho_tutelado_code,
        sierju_process_class_id: sierjuPatch.sierju_process_class_id,
        sierju_metadata: sierjuPatch.sierju_metadata,
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
      if (processDefinitionId) caseRow.process_definition_id = processDefinitionId;
      if (flow === 'tutela_primera') {
        caseRow.origin_court = null;
        caseRow.origin_radicado = null;
        caseRow.appellant = null;
        caseRow.origin_ruling = null;
      } else if (flow === 'tutela_segunda') {
        caseRow.origin_court = originCourt.trim();
        caseRow.origin_radicado = originRadicado.trim();
        caseRow.appellant = appellantSel;
        caseRow.origin_ruling = originRulingSel;
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

      const docRows: Array<Record<string, unknown>> = [];

      if (attachments.length > 0) {
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          const isEmail = isEmailBodyAttachment(att);
          const hasInlineContent = typeof att.content === 'string' && att.content.length > 0;
          const canFetchSession =
            !isEmail &&
            parseSessionId &&
            typeof att.sessionIndex === 'number' &&
            !hasInlineContent;

          if (!isEmail && !hasInlineContent && !canFetchSession) {
            docRows.push({
              case_id: caseId,
              name: att.filename,
              original_name: att.originalName || att.filename,
              type: isEmail ? 'email_body' : 'attachment',
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
            if (isEmail) {
              bytes = await emailBodyToPdfBytes(
                String(parsedData.subject || 'Correo de reparto'),
                String(parsedData.text || '')
              );
            } else if (canFetchSession && parseSessionId) {
              bytes = await fetchParseSessionAttachment(parseSessionId, att.sessionIndex);
            } else {
              bytes = base64ToUint8Array(att.content);
            }
          } catch {
            docRows.push({
              case_id: caseId,
              name: att.filename,
              original_name: att.originalName || att.filename,
              type: isEmail ? 'email_body' : 'attachment',
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
            type: isEmail ? 'email_body' : 'attachment',
            size: att.size ?? bytes.byteLength,
            content_type: isEmail ? 'application/pdf' : att.contentType,
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
          sgdePreflight?.sgdeRootId &&
          (sgdePreflight.status === 'listo' || sgdePreflight.status === 'incompleto')
        ) {
          try {
            const pub = await sgdePublishSegundaImpugnacion({
              caseId,
              originRadicado: originDigits,
              sgdeRootId: sgdePreflight.sgdeRootId,
            });
            const { data: u } = await supabase.auth.getUser();
            const uname = u.user?.user_metadata?.full_name || u.user?.email || 'Sistema';
            const actRow = deepSanitizeForPostgresInsert({
              case_id: caseId,
              type: 'sgde_publish_segunda',
              description: pub.message,
              user_id: u.user?.id ?? null,
              user_name: String(uname),
              metadata: {
                origin_radicado: originDigits,
                sgde_root_id: pub.sgdeRootId,
                impugnacion_folder_id: pub.impugnacionFolderId,
                uploaded: pub.uploaded,
                upload_failed: pub.uploadFailed,
              },
            });
            const { error: actErr } = await supabase.from('case_actions').insert(actRow);
            if (actErr) console.error('Actuación publicación SGDE segunda:', actErr);
            if (pub.uploadFailed > 0) {
              console.warn('SGDE impugnación partial failures:', pub.uploadErrors);
            }
          } catch (pubErr) {
            console.error('Publicación SGDE impugnación tras radicación:', pubErr);
          }

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
                description: `Copiados ${mig.migrated} PDF de SGDE al expediente digital Tutelia.`,
                user_id: u.user?.id ?? null,
                user_name: String(uname),
                metadata: {
                  origin_radicado: originDigits,
                  sgde_root_id: mig.sgdeRootId,
                  migrated: mig.migrated,
                  failed: mig.failed,
                },
              });
              await supabase.from('case_actions').insert(migRow);
            }
          } catch (migErr) {
            console.error('Copia SGDE → Tutelia tras radicación:', migErr);
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
      const errorMsg = getUserFriendlyRadicadoError(err);
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

  const handleAddAttachments = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setIsAddingAttachments(true);
    setError(null);
    try {
      const { added, errors } = await filesToNewCaseAttachments(files, attachments);
      if (errors.length) {
        setError(errors.join(' '));
      }
      if (!added.length) return;
      const startIdx = attachments.length;
      setAttachments((prev) => [...prev, ...added]);
      setSelectedDocIndex(startIdx);
      setSelectedForMerge([]);
      setEditingIndex(null);
    } catch {
      setError('No se pudieron agregar los archivos seleccionados.');
    } finally {
      setIsAddingAttachments(false);
    }
  };

  const handleRemoveAttachment = (idx: number) => {
    const label = attachments[idx]?.filename ?? 'este documento';
    if (!window.confirm(`¿Quitar «${label}» de la lista antes de radicar?`)) return;
    const next = attachments.filter((_, i) => i !== idx);
    setAttachments(next);
    setSelectedForMerge((prev) =>
      prev.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i))
    );
    if (editingIndex === idx) {
      setEditingIndex(null);
      setEditingName('');
    } else if (editingIndex !== null && editingIndex > idx) {
      setEditingIndex(editingIndex - 1);
    }
    if (selectedDocIndex === idx) {
      setSelectedDocIndex(next.length ? Math.min(idx, next.length - 1) : 0);
    } else if (selectedDocIndex > idx) {
      setSelectedDocIndex(selectedDocIndex - 1);
    }
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

    const itemsToMerge = selectedForMerge.map((idx) => attachments[idx]);

    if (!itemsToMerge.every((att) => isMergeableAttachment(att))) {
      setError('Solo se pueden unir archivos PDF o el correo de reparto.');
      return;
    }

    if (!parsedData) {
      setError('No hay datos del correo para incluir el documento de reparto en la unión.');
      return;
    }

    setIsMerging(true);
    try {
      const mergedPdf = await PDFDocument.create();

      for (const att of itemsToMerge) {
        let pdfBytes: Uint8Array;
        if (isEmailBodyAttachment(att)) {
          pdfBytes = await emailBodyToPdfBytes(
            String(parsedData.subject || 'Correo de reparto'),
            String(parsedData.text || '')
          );
        } else {
          const hasInline = typeof att.content === 'string' && att.content.length > 0;
          pdfBytes =
            parseSessionId && typeof att.sessionIndex === 'number' && !hasInline
              ? await fetchParseSessionAttachment(parseSessionId, att.sessionIndex)
              : base64ToUint8Array(att.content);
        }
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
    const currentDoc = attachments[selectedDocIndex];
    if (!currentDoc || isEmailBodyAttachment(currentDoc) || currentDoc.contentType !== 'application/pdf') {
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
          const normalized = normalizeLegalAnalysis(parsedCache[cacheKey]);
          setAiAnalysis(normalized);
          const subject =
            parsedData && typeof (parsedData as { subject?: unknown }).subject === 'string'
              ? String((parsedData as { subject: string }).subject)
              : '';
          const inferred = inferCaseTypeFromAnalysisCorpus(
            [subject, normalized.derechoTutelado, normalized.hechos, normalized.pretensiones].join(
              '\n',
            ),
            caseFlowType,
          );
          if (
            inferred &&
            inferred !== caseFlowType &&
            caseFlowType !== 'tutela_segunda' &&
            caseFlowType !== 'consulta_desacato'
          ) {
            setCaseFlowType(inferred);
            setSegundaPrefillNote(
              `Tipo ajustado por análisis IA: ${inferred}. Puede corregirlo manualmente si aplica.`,
            );
          }
          setIsAnalyzing(false);
          return;
        }
      }

      // Prompt se construye en servidor (legal-analysis-service). Cliente solo manda datos.
      const legalKind = mapTuteliaCaseTypeToLegalAnalysisKind(caseFlowType);

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
        headers: await apiAuthHeaders({ json: true }),
        body: JSON.stringify({
          caseType: legalKind,
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
      const normalized = normalizeLegalAnalysis(
        payload.analysis ?? JSON.parse(payload.text || '{}'),
      );
      setAiAnalysis(normalized);
      if (payload.pdfTruncated && payload.pdfPagesTotal && payload.pdfPagesUsed) {
        setSegundaPrefillNote(
          `IA leyó las primeras ${payload.pdfPagesUsed} de ${payload.pdfPagesTotal} páginas (inicio del escrito: partes, hechos y pretensiones). Revise anexos si hacen falta.`,
        );
      }
      const subject =
        parsedData && typeof (parsedData as { subject?: unknown }).subject === 'string'
          ? String((parsedData as { subject: string }).subject)
          : '';
      const sierjuFromAi = matchSierjuTipoFromText(normalized.derechoTutelado);
      if (sierjuFromAi && isCivilCaseType(caseFlowType ?? sierjuFromAi.caseType)) {
        void applySierjuTipoSelection(sierjuFromAi.code, {
          caseType: sierjuFromAi.caseType,
          note: `Tipo SIERJU por IA: ${sierjuFromAi.label}.`,
        });
      } else {
        const inferred = inferCaseTypeFromAnalysisCorpus(
          [subject, normalized.derechoTutelado, normalized.hechos, normalized.pretensiones].join('\n'),
          caseFlowType,
        );
        if (inferred && inferred !== caseFlowType) {
          const locked =
            caseFlowType === 'tutela_segunda' || caseFlowType === 'consulta_desacato';
          if (!locked) {
            if (inferred.startsWith('civil_')) {
              const hit =
                matchSierjuTipoFromText(
                  [normalized.derechoTutelado, normalized.hechos, normalized.pretensiones].join('\n'),
                ) || findSierjuTipoByCode('otros_procesos');
              void applySierjuTipoSelection(hit?.code || 'otros_procesos', {
                caseType: inferred,
                note: hit
                  ? `Tipo SIERJU Civil-Oral ajustado por IA: ${hit.label}.`
                  : `Tipo ajustado por análisis IA: ${inferred}.`,
              });
            } else {
              setCaseFlowType(inferred);
              setSierjuTipoCode(undefined);
              setSegundaPrefillNote(
                `Tipo ajustado por análisis IA: ${inferred}. Puede corregirlo manualmente si aplica.`,
              );
            }
          }
        }
      }
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
          <p className="text-sm font-medium text-slate-500 mt-1">
            Un solo canal: cargue el correo y la IA identifica el tipo de proceso y los datos del expediente
          </p>
        </div>
        <div className="px-4 py-2 bg-blue-50 text-accent rounded-lg border border-blue-100 text-xs font-bold uppercase tracking-widest">
           Canal Digital
        </div>
      </header>

      {!parsedData ? (
        <CaseEmailParser
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

            <CaseTypeInferredBanner
              caseFlowType={caseFlowType ?? 'tutela_primera'}
              sierjuCode={sierjuTipoCode}
              disabled={isRadicating}
              sourceNote={segundaPrefillNote}
              onChange={(next, meta) => {
                setError(null);
                if (meta?.sierjuCode) {
                  void applySierjuTipoSelection(meta.sierjuCode, {
                    caseType: next,
                    note: meta.sierjuLabel
                      ? `Tipo SIERJU Civil-Oral: ${meta.sierjuLabel}.`
                      : undefined,
                  });
                  return;
                }
                setCaseFlowType(next);
                setSierjuTipoCode(undefined);
                if (next !== 'tutela_segunda' && next !== 'consulta_desacato') {
                  setSegundaPrefillNote(
                    isCivilCaseType(next)
                      ? 'Seleccione la fila SIERJU TIPOS PROCESOS Civil-Oral en el selector.'
                      : 'Tipo actualizado. Revise consecutivo y datos antes de radicar.',
                  );
                }
              }}
            />

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

            {caseFlowType === 'tutela_segunda' ? (
              <CaseSgdeSegundaPreflightPanel
                key={`sgde-pf-${originRadicado.replace(/\D/g, '') || 'none'}`}
                originRadicado={originRadicado}
                sgdeNodeIdHint={sgdeNodeIdHint}
                emailDigest={segundaEmailDigest}
                disabled={isRadicating}
                onPreflightChange={setSgdePreflight}
                onSegundaExtract={applySegundaFieldsExtract}
              />
            ) : null}

            <CaseRadicacionConsecutivePanel
              consecutive={consecutive}
              setConsecutive={setConsecutive}
              consecutiveLoading={consecutiveLoading}
              consecutiveReady={consecutiveReady}
              radicadoConflict={radicadoConflict}
              radicacion={radicacion}
              instanceCode={
                caseFlowType ? instanceCodeForCaseType(caseFlowType) : CUI_INSTANCE_PRIMERA
              }
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

          {caseFlowType ? (
            <div className="lg:col-span-12 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
              <CaseSierjuClassification
                courtId={courtId}
                caseType={caseFlowType}
                processDefinitionId={processForCaseType(caseFlowType)?.id}
                valueDerechoCode={sierjuDerechoSel}
                valueClassId={sierjuClassIdSel}
                disabled={isRadicating}
                label={
                  isCivilCaseType(caseFlowType)
                    ? 'Clasificación SIERJU Civil-Oral antes de radicar'
                    : caseFlowType === 'tutela_segunda'
                      ? 'Clasificación SIERJU Impugnaciones (hoja 13) antes de radicar'
                      : caseFlowType === 'consulta_desacato'
                        ? 'Clasificación SIERJU Consultas desacato (hoja 15) antes de radicar'
                        : 'Clasificación SIERJU Tutelas (hoja 8) antes de radicar'
                }
                hint={
                  isCivilCaseType(caseFlowType)
                    ? 'Solo filas TIPOS PROCESOS de Primera y única instancia Civil-Oral (vigente). Civil-Escrito ya no aplica.'
                    : caseFlowType === 'tutela_segunda'
                      ? 'Solo filas TIPOS PROCESOS de Movimiento de Impugnaciones (hoja 13). Mismos 12 derechos que tutelas.'
                      : caseFlowType === 'consulta_desacato'
                        ? 'Solo filas TIPOS PROCESOS de Consultas Incidentes de Desacato (hoja 15). Mismos 12 derechos.'
                        : 'Solo filas TIPOS PROCESOS de Movimiento de Tutelas (hoja 8). No use Acciones constitucionales (hoja 7).'
                }
                onChange={({ derechoCode, classId, option }) => {
                  setSierjuDerechoSel(derechoCode);
                  setSierjuClassIdSel(classId);
                  if (option?.code && isCivilCaseType(caseFlowType)) {
                    setSierjuTipoCode(option.code);
                    const hit = findSierjuTipoByCode(option.code);
                    if (hit) setCaseFlowType(hit.caseType);
                  }
                }}
              />
            </div>
          ) : null}

          <div className="lg:col-span-12">
            <CaseRadicacionActions
              aiAnalysis={aiAnalysis}
              isRadicating={isRadicating}
              consecutiveReady={consecutiveReady}
              error={error}
              onRadicate={handleRadicate}
            />
          </div>

          {/* Metadatos y visor alineados en la misma fila */}
          <div className="lg:col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 min-w-0">
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
                archiveLinkStatus={archiveLinkStatus}
                archiveLinkError={archiveLinkError}
                onRetryArchiveLink={
                  parseSessionId
                    ? () =>
                        void fetchArchiveFromParseSession(
                          parseSessionId,
                          typeof parsedData?.linkUrl === 'string' ? parsedData.linkUrl : null,
                        )
                    : undefined
                }
                onAddAttachments={handleAddAttachments}
                onRemoveAttachment={handleRemoveAttachment}
                isAddingAttachments={isAddingAttachments}
              />
            </div>

            <div className="lg:col-span-7 card-modern overflow-hidden bg-white flex flex-col min-h-[min(78vh,820px)] max-h-[min(78vh,820px)] min-w-0">
             <div className="shrink-0 px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                    {isEmailBodyAttachment(attachments[selectedDocIndex] || {})
                      ? 'Vista Previa del Correo Judicial'
                      : `Visor: ${attachments[selectedDocIndex]?.filename}`}
                  </h2>
                  {attachments[selectedDocIndex]?.contentType === 'application/pdf' &&
                    !isEmailBodyAttachment(attachments[selectedDocIndex] || {}) && (
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
             
             <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
               {isEmailBodyAttachment(attachments[selectedDocIndex] || {}) ? (
                 <>
                   <div className="shrink-0 space-y-1 border-b border-slate-200 bg-slate-50 p-4 text-[10px]">
                     <div className="flex gap-2">
                         <span className="font-bold text-slate-400 w-12 uppercase">De:</span>
                         <span className="text-slate-600 truncate">{parsedData.from}</span>
                     </div>
                     <div className="flex gap-2">
                         <span className="font-bold text-slate-400 w-12 uppercase">Fecha:</span>
                         <span className="text-slate-600">{parsedData.date ? new Date(parsedData.date).toLocaleString('es-CO') : 'Reciente'}</span>
                     </div>
                     {parsedData.linkFound ? (
                       <p className="pt-1 text-[10px] leading-snug text-blue-700">
                         El expediente (demanda, acta, anexos) está en los documentos <strong>LINK</strong> o PDF de la lista, no en este aviso de reparto.
                       </p>
                     ) : null}
                   </div>
                   <CaseEmailHtmlPreview html={parsedData.html} text={parsedData.text} />
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
                     displayMode="scroll"
                   />
                 </div>
               )}
             </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
