import type { DecisionType, DerechoTuteladoCode } from './lib/sierju-case-codes';

export type { DecisionType, DerechoTuteladoCode };

export type UserRole =
  | 'admin'
  | 'judge'
  | 'clerk'
  | 'official'
  | 'sustanciador'
  | 'escribiente'
  | 'asistente_judicial';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  courtId: string;
  /** Bypass RLS multi-despacho (administración de plataforma). */
  isSuperuser?: boolean;
}

export type CaseStatus = 'received' | 'admitted' | 'transfer' | 'judgment' | 'archived';

/** Clasificación al radicar (columna `cases.case_type`). */
export type CaseType = 'tutela_primera' | 'tutela_segunda' | 'consulta_desacato';

/** Quién impugna en segunda instancia (`cases.appellant`). */
export type CaseAppellant = 'accionante' | 'accionado';

/** Sentido del fallo de origen (`cases.origin_ruling`, sin tilde por CHECK en BD). */
export type CaseOriginRuling = 'concedio' | 'nego';

/** Plantillas documentales por despacho (tabla `document_templates`). */
export type DocumentTemplateCategoria = 'despacho' | 'secretaria';

export type DocumentTemplateTipo = 'informe_ingreso' | 'auto_admisorio' | 'libre';

/**
 * Opción condicional del despacho.
 * - En el documento use `{{documentMarker}}` (ej. BLOQUE_MEDIDA_PROVISIONAL): pastilla legible; sigue admitiéndose `{{id}}` por compatibilidad.
 * - TipTap: párrafos con menú Condicional usan `toggleKey === id` internamente.
 */
export interface DocumentTemplateToggleDef {
  id: string;
  label: string;
  description: string;
  /** Si la opción está activa al generar el borrador cuando no hay otro criterio. */
  defaultOn: boolean;
  /** Texto que sustituye al marcador al generar si el toggle está activo (admite `{{VARIABLES}}` del expediente). */
  blockContent: string;
  /**
   * Clave en el .doc: `{{documentMarker}}`. Mayúsculas y guiones bajos recomendados (ej. BLOQUE_MEDIDA_PROVISIONAL).
   * Si queda vacío, en el editor solo se usa el marcador `{{id}}` (poco legible).
   */
  documentMarker: string;
}

/** Márgenes y tipografía propios de cada plantilla (vista previa + .docx generado en app). */
export interface DocumentTemplatePageLayout {
  marginMm: { top: number; right: number; bottom: number; left: number };
  fontFamily: string;
  fontSizePt: number;
}

export interface DocumentTemplate {
  id: string;
  courtId: string;
  categoria: DocumentTemplateCategoria;
  tipo: DocumentTemplateTipo;
  nombre: string;
  descripcion?: string;
  /** Texto con {{VARIABLES}}; null = usar borrador por defecto en `plantilla-variables`. */
  contenidoBase: string | null;
  /** Bloques condicionales configurables (vacío = sin opciones). */
  toggleDefs: DocumentTemplateToggleDef[];
  sortOrder: number;
  /** Ruta en bucket `document-templates`; si existe, la descarga del expediente usa docxtemplater. */
  docxStoragePath: string | null;
  /** Último mapeo IA confirmado (original → marcador). */
  docxMapeo: Array<{ original: string; marcador: string }> | null;
  /**
   * Márgenes (mm), familia y tamaño de letra; null = valores por defecto del sistema (Times 12 pt, márgenes 25 mm).
   * No aplica al .docx subido como archivo (docxStoragePath): ese archivo conserva su propio diseño.
   */
  pageLayout: DocumentTemplatePageLayout | null;
}

export interface Case {
  id: string;
  radicado: string;
  courtId: string;
  claimant: string;
  defendant: string;
  status: CaseStatus;
  operationalStatus?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  deadlineAt?: string;
  /** Motivo o referencia si se ajusta `deadline_at` a mano (suspensión, rectificación, etc.). */
  deadlineOverrideNote?: string;
  sgdeId?: string;
  /** Fecha de vinculación con nodo raíz SGDE (`rama:expedientes`). */
  sgdeLinkedAt?: string;
  sgdeSyncStatus?: 'idle' | 'linked' | 'syncing' | 'error' | 'stale';
  sourceChannel?: string;
  summary?: string;
  subject?: string;
  rawText?: string;
  rawHtml?: string;
  emailMetadata?: Record<string, unknown>;
  /** Cuadernos de incidente u otros (no el C01); cada uno tiene code estable y etiqueta visible. */
  expedienteCuadernosExtra?: Array<{ code: string; label: string }>;
  /** Secretaría marcó informe de ingreso; habilita auto admisorio (columna en Supabase). */
  informeIngresoRegistradoAt?: string;
  /** Pieza PDF del informe incorporada al expediente digital (referencia; la pieza persiste). */
  informeIngresoDocumentId?: string;
  // Legal Extraction Fields
  claimantId?: string;
  claimantEmail?: string;
  defendantId?: string;
  defendantEmail?: string;
  legalHechos?: string;
  legalPretensiones?: string;
  legalDerechoTutelado?: string;
  /** Clasificación SIERJU (filas «Movimiento de Tutelas»); el texto detallado sigue en `legalDerechoTutelado`. */
  derechoTuteladoCode?: DerechoTuteladoCode;
  /** Al fallar o archivar: tipo de decisión para estadística. */
  decisionType?: DecisionType;
  legalIdentificaciones?: string;
  caseType?: CaseType;
  originCourt?: string;
  originRadicado?: string;
  appellant?: CaseAppellant;
  originRuling?: CaseOriginRuling;
  /** Consulta de desacato: decisión o acto objeto de consulta. */
  conductDescription?: string;
}

/** Documentos por revisar (Word) — tabla `case_word_reviews`. */
export type WordReviewStatus =
  | 'pendiente_juez'
  | 'observaciones_juez'
  | 'aprobado_firma_pendiente'
  | 'cerrado_con_pdf_firmado';

/** Revisión enriquecida en Tutelia (TipTap); columna `review_markup_json`. */
export type CaseWordReviewMarkupV1 = {
  v: 1;
  /** Legacy: JSON TipTap. Preferir `storage` (`tiptap:` + JSON) para nuevas escrituras. */
  doc?: Record<string, unknown>;
  /** Serialización unificada (`docToStorage` / `parseStorageToDoc`). */
  storage?: string;
  /** Contenido al abrir el ciclo (p. ej. semilla Mammoth); para resumen diff post-revisión. */
  baselineDoc?: Record<string, unknown>;
  commentThreads?: Record<string, unknown>;
  previewSketch?: Record<string, unknown>;
};

export interface CaseWordReview {
  id: string;
  caseId: string;
  wordDocumentId: string;
  status: WordReviewStatus;
  judgeNotes?: string;
  sustanciadorReply?: string;
  signedPdfDocumentId?: string;
  /** Capa editable en la app (subrayado, resaltado, comentarios); no reemplaza el .docx del expediente. */
  reviewMarkupJson?: CaseWordReviewMarkupV1 | null;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  caseId: string;
  type: string;
  name: string;
  storageKey?: string;
  /** Ruta en el bucket `case-documents` (p. ej. `cases/{case_id}/...`). */
  storagePath?: string;
  hash?: string;
  sgdeId?: string;
  /** Ruta en SGDE (instancia / cuaderno). */
  sgdeFolderPath?: string;
  sgdeSyncStatus?: 'none' | 'linked' | 'local_only' | 'sgde_only';
  createdAt: string;
  content?: string;
  contentType?: string;
  size?: number;
  originalName?: string;
  order?: number;
  isFromLink?: boolean;
  /** Texto de `case_documents.error` (p. ej. adjunto >1MB no guardado en fila). */
  ingestError?: string;
  /** Cuaderno del expediente (p. ej. cuaderno principal C01, incidente de desacato). */
  notebookCode?: string;
}

export interface Action {
  id: string;
  caseId: string;
  userId: string;
  userName: string;
  type: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/** Historial técnico interno (tabla `case_audit_log`); no es actuación judicial. */
export interface CaseAuditLogEntry {
  id: string;
  caseId: string;
  occurredAt: string;
  actorUserId?: string;
  sourceTable: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId?: string;
  payload: Record<string, unknown>;
}

/**
 * Regla al radicar para persistir `cases.assigned_to` (sustanciador).
 * Configurable por fila en `public.courts`.
 */
export type SustanciadorAssignmentMode =
  | 'hash_stable'
  | 'radicado_parity'
  | 'alternating'
  | 'manual_unassigned';

export interface Court {
  id: string;
  name: string;
  email: string;
  city: string;
  sustanciadorAssignmentMode?: SustanciadorAssignmentMode;
  /** 0 o 1: siguiente índice en modo alternating (una y una). */
  sustanciadorRrCursor?: number;
}
