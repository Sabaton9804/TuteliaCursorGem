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
  // Legal Extraction Fields
  claimantId?: string;
  claimantEmail?: string;
  defendantId?: string;
  defendantEmail?: string;
  legalHechos?: string;
  legalPretensiones?: string;
  legalDerechoTutelado?: string;
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
