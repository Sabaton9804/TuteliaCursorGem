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
}

export type CaseStatus = 'received' | 'admitted' | 'transfer' | 'judgment' | 'archived';

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
  sgdeId?: string;
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

export interface Court {
  id: string;
  name: string;
  email: string;
  city: string;
}
