import type { CaseAuditLogEntry } from '../types';

const CASE_STATUS_ES: Record<string, string> = {
  received: 'Recibido',
  admitted: 'Admitido',
  transfer: 'Traslado',
  judgment: 'Fallo',
  archived: 'Archivado',
};

const WORD_REVIEW_STATUS_ES: Record<string, string> = {
  pendiente_juez: 'Pendiente de juez',
  observaciones_juez: 'Con observaciones del juez',
  aprobado_firma_pendiente: 'Aprobado (firma pendiente)',
  cerrado_con_pdf_firmado: 'Cerrado con PDF firmado',
};

function payloadRow(
  payload: Record<string, unknown>,
  which: 'old' | 'new'
): Record<string, unknown> | undefined {
  const v = payload[which];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function docDisplayName(r: Record<string, unknown>): string {
  const name = str(r.name || r.original_name).trim();
  return name || 'Documento sin nombre';
}

function eqJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Campos de `cases` que no merecen mención individual (borrador masivo, etc.). */
const CASE_SKIP_KEYS = new Set(['updated_at', 'raw_text', 'raw_html', 'email_metadata', 'content']);

function describeCaseFieldChange(key: string, oldVal: unknown, newVal: unknown): string | null {
  switch (key) {
    case 'assigned_to': {
      const o = str(oldVal).trim();
      const n = str(newVal).trim();
      if (!o && n) return `asignó el expediente a «${n}»`;
      if (o && !n) return 'quitó la asignación del sustanciador';
      if (o !== n) return `cambió la asignación de «${o}» a «${n}»`;
      return null;
    }
    case 'status': {
      const o = CASE_STATUS_ES[str(oldVal)] ?? str(oldVal);
      const n = CASE_STATUS_ES[str(newVal)] ?? str(newVal);
      if (o !== n) return `cambió el estado judicial de «${o}» a «${n}»`;
      return null;
    }
    case 'operational_status': {
      if (eqJson(oldVal, newVal)) return null;
      return 'actualizó el estado operativo del expediente';
    }
    case 'deadline_at':
    case 'deadline_override_note': {
      if (eqJson(oldVal, newVal)) return null;
      return 'ajustó el plazo o la nota asociada al término';
    }
    case 'summary': {
      if (eqJson(oldVal, newVal)) return null;
      return 'actualizó la síntesis procesal del expediente';
    }
    case 'radicado': {
      if (str(oldVal) === str(newVal)) return null;
      return 'modificó el radicado';
    }
    case 'derecho_tutelado_code':
    case 'decision_type': {
      if (eqJson(oldVal, newVal)) return null;
      return 'actualizó la clasificación o el tipo de decisión (SIERJU / decisión)';
    }
    default:
      break;
  }
  if (CASE_SKIP_KEYS.has(key)) return null;
  if (eqJson(oldVal, newVal)) return null;
  return `actualizó «${key.replace(/_/g, ' ')}»`;
}

function describeCasesUpdate(oldR: Record<string, unknown>, newR: Record<string, unknown>): string {
  const parts: string[] = [];
  const keys = new Set([...Object.keys(oldR), ...Object.keys(newR)]);
  for (const key of keys) {
    if (key === 'id') continue;
    const line = describeCaseFieldChange(key, oldR[key], newR[key]);
    if (line) parts.push(line);
  }
  if (parts.length === 0) return 'guardó cambios en el expediente';
  if (parts.length === 1) return parts[0]!;
  const head = parts.slice(0, -1).join('; ');
  return `${head}; y ${parts[parts.length - 1]}`;
}

function describeCaseActionsRow(r: Record<string, unknown>, operation: CaseAuditLogEntry['operation']): string {
  const typ = str(r.type);
  const desc = str(r.description).trim();
  if (operation === 'DELETE') return 'eliminó una fila del libro de actuaciones del expediente';
  if (operation === 'UPDATE') {
    return desc ? `modificó una actuación: ${desc}` : 'modificó una entrada del libro de actuaciones';
  }
  if (desc) {
    if (typ === 'assignment') return `registró una asignación: ${desc}`;
    if (typ === 'manual_entry') return `añadió una actuación manual: ${desc}`;
    if (typ === 'ai_synthesis') return `dejó constancia: ${desc}`;
    if (typ === 'status_change') return `registró cambio de estado: ${desc}`;
    if (typ === 'derecho_tutelado_code' || typ === 'decision_type') return `actualizó clasificación: ${desc}`;
    return `registró en actuaciones: ${desc}`;
  }
  return typ ? `añadió una actuación (tipo «${typ}»)` : 'añadió una entrada en actuaciones';
}

function describeWordReview(
  operation: CaseAuditLogEntry['operation'],
  oldR: Record<string, unknown> | undefined,
  newR: Record<string, unknown> | undefined
): string {
  if (operation === 'INSERT')
    return 'creó un flujo de revisión Word para una pieza del expediente';
  if (operation === 'DELETE') return 'eliminó un registro de revisión Word';
  const o = oldR?.status;
  const n = newR?.status;
  if (str(o) !== str(n) && (o !== undefined || n !== undefined)) {
    const os = WORD_REVIEW_STATUS_ES[str(o)] ?? str(o);
    const ns = WORD_REVIEW_STATUS_ES[str(n)] ?? str(n);
    return `cambió el estado de la revisión Word de «${os}» a «${ns}»`;
  }
  return 'actualizó la revisión Word (notas, respuesta o PDF firmado)';
}

function describeUserNotification(
  operation: CaseAuditLogEntry['operation'],
  oldR: Record<string, unknown> | undefined,
  newR: Record<string, unknown> | undefined
): string {
  if (operation === 'INSERT') {
    const title = str(newR?.title).trim();
    return title
      ? `generó una notificación interna: «${title}»`
      : 'generó una notificación interna';
  }
  if (operation === 'DELETE') return 'eliminó una notificación interna';
  const readOld = oldR?.read_at;
  const readNew = newR?.read_at;
  if (!readOld && readNew) return 'marcó como leída una notificación interna';
  return 'actualizó una notificación interna';
}

export type HumanizedAuditKind = 'add' | 'edit' | 'remove' | 'neutral';

export interface HumanizedAuditLine {
  /** Frase en segunda persona / narrativa: «añadió…», «cambió…». Sin nombre de usuario. */
  action: string;
  kind: HumanizedAuditKind;
  /** Texto auxiliar (p. ej. tipo técnico). */
  hint?: string;
}

/**
 * Convierte una fila de `case_audit_log` en lenguaje natural para el despacho.
 */
export function humanizeCaseAuditEntry(entry: CaseAuditLogEntry): HumanizedAuditLine {
  const table = entry.sourceTable;
  const op = entry.operation;
  const oldR = payloadRow(entry.payload, 'old');
  const newR = payloadRow(entry.payload, 'new');

  if (table === 'case_documents') {
    if (op === 'INSERT') {
      const name = newR ? docDisplayName(newR) : 'un documento';
      return { action: `añadió al expediente digital el documento «${name}»`, kind: 'add' };
    }
    if (op === 'DELETE') {
      const name = oldR ? docDisplayName(oldR) : 'un documento';
      return { action: `eliminó del expediente digital el documento «${name}»`, kind: 'remove' };
    }
    const name = newR ? docDisplayName(newR) : oldR ? docDisplayName(oldR) : 'un documento';
    return { action: `actualizó el documento «${name}»`, kind: 'edit' };
  }

  if (table === 'cases') {
    if (op === 'INSERT')
      return { action: 'registró el expediente en el sistema', kind: 'add', hint: 'alta de caso' };
    if (op === 'DELETE')
      return { action: 'eliminó el expediente del sistema', kind: 'remove' };
    if (oldR && newR) {
      const action = describeCasesUpdate(oldR, newR);
      return { action, kind: 'edit' };
    }
    return { action: 'actualizó datos del expediente', kind: 'edit' };
  }

  if (table === 'case_actions') {
    const row = newR ?? oldR;
    if (row) {
      const action = describeCaseActionsRow(row, op);
      const kind: HumanizedAuditKind =
        op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit';
      return { action, kind, hint: 'libro de actuaciones' };
    }
    return { action: 'modificó el libro de actuaciones', kind: 'edit' };
  }

  if (table === 'case_word_reviews') {
    return {
      action: describeWordReview(op, oldR, newR),
      kind: op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit',
    };
  }

  if (table === 'user_notifications') {
    return {
      action: describeUserNotification(op, oldR, newR),
      kind: op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit',
      hint: 'notificación in-app',
    };
  }

  const opEs =
    op === 'INSERT' ? 'Creó un registro' : op === 'DELETE' ? 'Eliminó un registro' : 'Modificó un registro';
  return {
    action: `${opEs.toLowerCase()} en «${table}»`,
    kind: op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit',
    hint: 'tabla no reconocida; ver JSON',
  };
}
