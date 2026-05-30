import type {
  Action,
  Case,
  CaseAppellant,
  CaseAuditLogEntry,
  CaseOriginRuling,
  CaseStatus,
  CaseType,
  CaseWordReview,
  Document,
  UserProfile,
  WordReviewStatus,
} from '../types';
import { parseDecisionType, parseDerechoTuteladoCode } from './sierju-case-codes';
import type { CaseSierjuMetadata, FundamentalRightCode } from './sierju-types';
import { FUNDAMENTAL_RIGHT_CODES } from './sierju-types';
import { parseUserRole } from './user-roles';
import { DEFAULT_DEMO_COURT_ID } from './default-court';

function parseCaseType(v: unknown): CaseType | undefined {
  if (v === 'tutela_primera' || v === 'tutela_segunda' || v === 'consulta_desacato') return v;
  return undefined;
}

function parseCaseAppellant(v: unknown): CaseAppellant | undefined {
  if (v === 'accionante' || v === 'accionado') return v;
  return undefined;
}

function parseCaseOriginRuling(v: unknown): CaseOriginRuling | undefined {
  if (v === 'concedio' || v === 'nego') return v;
  return undefined;
}

function parseSierjuMetadata(raw: unknown): CaseSierjuMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const fundamental =
    typeof o.fundamental_right === 'string' &&
    (FUNDAMENTAL_RIGHT_CODES as readonly string[]).includes(o.fundamental_right)
      ? (o.fundamental_right as FundamentalRightCode)
      : undefined;
  const procedureMode =
    o.procedure_mode === 'escrito' || o.procedure_mode === 'oral' ? o.procedure_mode : undefined;
  const quantiaBand = typeof o.quantia_band === 'string' ? o.quantia_band : undefined;
  const notes = typeof o.notes === 'string' ? o.notes : undefined;
  if (!fundamental && !procedureMode && !quantiaBand && !notes) return undefined;
  return {
    ...(fundamental ? { fundamental_right: fundamental } : {}),
    ...(procedureMode ? { procedure_mode: procedureMode } : {}),
    ...(quantiaBand ? { quantia_band: quantiaBand } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function rowToCase(row: Record<string, unknown>): Case {
  const ts = (v: unknown) => (typeof v === 'string' ? v : v ? String(v) : '');
  return {
    id: String(row.id),
    radicado: String(row.radicado ?? ''),
    courtId: String(row.court_id ?? ''),
    claimant: String(row.claimant ?? ''),
    defendant: String(row.defendant ?? ''),
    status: (row.status as CaseStatus) || 'received',
    operationalStatus: row.operational_status ? String(row.operational_status) : undefined,
    assignedTo: row.assigned_to ? String(row.assigned_to) : undefined,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
    deadlineAt: row.deadline_at ? ts(row.deadline_at) : undefined,
    deadlineOverrideNote: row.deadline_override_note
      ? String(row.deadline_override_note)
      : undefined,
    sgdeId: row.sgde_id ? String(row.sgde_id) : undefined,
    sgdeLinkedAt: row.sgde_linked_at ? ts(row.sgde_linked_at) : undefined,
    sgdeSyncStatus: row.sgde_sync_status
      ? (String(row.sgde_sync_status) as Case['sgdeSyncStatus'])
      : undefined,
    sourceChannel: row.source_channel ? String(row.source_channel) : undefined,
    summary: row.summary ? String(row.summary) : undefined,
    claimantId: row.claimant_id ? String(row.claimant_id) : undefined,
    claimantEmail: row.claimant_email ? String(row.claimant_email) : undefined,
    defendantId: row.defendant_id ? String(row.defendant_id) : undefined,
    defendantEmail: row.defendant_email ? String(row.defendant_email) : undefined,
    legalHechos: row.legal_hechos ? String(row.legal_hechos) : undefined,
    legalPretensiones: row.legal_pretensiones ? String(row.legal_pretensiones) : undefined,
    legalDerechoTutelado: row.legal_derecho_tutelado ? String(row.legal_derecho_tutelado) : undefined,
    derechoTuteladoCode: parseDerechoTuteladoCode(row.derecho_tutelado_code),
    sierjuProcessClassId: row.sierju_process_class_id ? String(row.sierju_process_class_id) : undefined,
    sierjuMetadata: parseSierjuMetadata(row.sierju_metadata),
    decisionType: parseDecisionType(row.decision_type),
    decisionAt: row.decision_at ? ts(row.decision_at) : undefined,
    legalIdentificaciones: row.legal_identificaciones ? String(row.legal_identificaciones) : undefined,
    subject: row.subject ? String(row.subject) : undefined,
    rawText: row.raw_text ? String(row.raw_text) : undefined,
    rawHtml: row.raw_html ? String(row.raw_html) : undefined,
    emailMetadata: (row.email_metadata as Record<string, unknown>) || undefined,
    expedienteCuadernosExtra: parseExpedienteCuadernosExtra(row.expediente_cuadernos_extra),
    informeIngresoRegistradoAt: row.informe_ingreso_registrado_at
      ? ts(row.informe_ingreso_registrado_at)
      : undefined,
    informeIngresoDocumentId: row.informe_ingreso_document_id
      ? String(row.informe_ingreso_document_id)
      : undefined,
    caseType: parseCaseType(row.case_type),
    originCourt: row.origin_court ? String(row.origin_court) : undefined,
    originRadicado: row.origin_radicado ? String(row.origin_radicado) : undefined,
    appellant: parseCaseAppellant(row.appellant),
    originRuling: parseCaseOriginRuling(row.origin_ruling),
    conductDescription: row.conduct_description ? String(row.conduct_description) : undefined,
  };
}

function parseExpedienteCuadernosExtra(raw: unknown): Array<{ code: string; label: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ code: string; label: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.code === 'string' ? o.code.trim() : '';
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (code && label) out.push({ code, label });
  }
  return out.length > 0 ? out : undefined;
}

export function rowToCaseDoc(row: Record<string, unknown>, caseId: string): Document {
  return {
    id: String(row.id),
    caseId,
    name: String(row.name ?? ''),
    type: String(row.type ?? ''),
    storageKey: row.storage_path
      ? String(row.storage_path)
      : row.storage_key
        ? String(row.storage_key)
        : '',
    storagePath: row.storage_path ? String(row.storage_path) : undefined,
    hash: row.hash ? String(row.hash) : '',
    sgdeId: row.sgde_id ? String(row.sgde_id) : undefined,
    sgdeFolderPath: row.sgde_folder_path ? String(row.sgde_folder_path) : undefined,
    sgdeSyncStatus: row.sgde_sync_status
      ? (String(row.sgde_sync_status) as Document['sgdeSyncStatus'])
      : undefined,
    createdAt: typeof row.created_at === 'string' ? row.created_at : String(row.created_at ?? ''),
    content: row.content ? String(row.content) : undefined,
    contentType: row.content_type ? String(row.content_type) : undefined,
    size: typeof row.size === 'number' ? row.size : row.size != null ? Number(row.size) : undefined,
    originalName: row.original_name ? String(row.original_name) : undefined,
    order: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order ?? 0),
    isFromLink: Boolean(row.is_from_link),
    ingestError: row.error ? String(row.error) : undefined,
    notebookCode: row.notebook_code ? String(row.notebook_code) : 'PI_C01_PRINCIPAL',
    fileHash: row.file_hash ? String(row.file_hash) : undefined,
  };
}

export function rowToAction(row: Record<string, unknown>): Action {
  const ts = row.created_at ? (typeof row.created_at === 'string' ? row.created_at : String(row.created_at)) : '';
  return {
    id: String(row.id),
    caseId: String(row.case_id ?? ''),
    userId: row.user_id ? String(row.user_id) : '',
    userName: String(row.user_name ?? ''),
    type: String(row.type ?? ''),
    description: String(row.description ?? ''),
    timestamp: ts,
    metadata: (row.metadata as Record<string, unknown>) || undefined,
  };
}

const AUDIT_OPS = new Set(['INSERT', 'UPDATE', 'DELETE']);

export function rowToCaseAuditLogEntry(row: Record<string, unknown>): CaseAuditLogEntry {
  const ts = (v: unknown) => (typeof v === 'string' ? v : v ? String(v) : '');
  const op = String(row.operation ?? '');
  return {
    id: String(row.id),
    caseId: String(row.case_id ?? ''),
    occurredAt: ts(row.occurred_at),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : undefined,
    sourceTable: String(row.source_table ?? ''),
    operation: AUDIT_OPS.has(op) ? (op as CaseAuditLogEntry['operation']) : 'UPDATE',
    rowId: row.row_id ? String(row.row_id) : undefined,
    payload: (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>,
  };
}

export function rowToUserProfile(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    name: String(row.name ?? ''),
    role: parseUserRole(row.role),
    courtId: String(row.court_id ?? DEFAULT_DEMO_COURT_ID),
    isSuperuser: row.is_superuser === true,
  };
}

const WORD_REVIEW_STATUSES = new Set<WordReviewStatus>([
  'pendiente_juez',
  'observaciones_juez',
  'aprobado_firma_pendiente',
  'cerrado_con_pdf_firmado',
]);

function parseWordReviewStatus(raw: unknown): WordReviewStatus {
  const s = (typeof raw === 'string' ? raw : '').trim();
  return WORD_REVIEW_STATUSES.has(s as WordReviewStatus) ? (s as WordReviewStatus) : 'pendiente_juez';
}

function parseReviewMarkupJson(raw: unknown): CaseWordReview['reviewMarkupJson'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return undefined;
  const row: CaseWordReview['reviewMarkupJson'] = { v: 1 };
  if (typeof o.storage === 'string' && o.storage.trim()) {
    row.storage = o.storage.trim();
  }
  if (o.doc != null && typeof o.doc === 'object') {
    row.doc = o.doc as Record<string, unknown>;
  }
  if (!row.doc && !row.storage) return undefined;
  if (o.baselineDoc != null && typeof o.baselineDoc === 'object') {
    row.baselineDoc = o.baselineDoc as Record<string, unknown>;
  }
  if (o.commentThreads != null && typeof o.commentThreads === 'object') {
    row.commentThreads = o.commentThreads as Record<string, unknown>;
  }
  if (o.previewSketch != null && typeof o.previewSketch === 'object') {
    row.previewSketch = o.previewSketch as Record<string, unknown>;
  }
  return row;
}

export function rowToCaseWordReview(row: Record<string, unknown>): CaseWordReview {
  const ts = (v: unknown) => (typeof v === 'string' ? v : v ? String(v) : '');
  return {
    id: String(row.id),
    caseId: String(row.case_id ?? ''),
    wordDocumentId: String(row.word_document_id ?? ''),
    status: parseWordReviewStatus(row.status),
    judgeNotes: row.judge_notes != null && String(row.judge_notes).trim() ? String(row.judge_notes) : undefined,
    sustanciadorReply:
      row.sustanciador_reply != null && String(row.sustanciador_reply).trim()
        ? String(row.sustanciador_reply)
        : undefined,
    signedPdfDocumentId: row.signed_pdf_document_id ? String(row.signed_pdf_document_id) : undefined,
    reviewMarkupJson: parseReviewMarkupJson(row.review_markup_json),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
  };
}
