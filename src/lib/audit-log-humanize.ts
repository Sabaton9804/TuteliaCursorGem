import type { CaseAuditLogEntry } from '../types';

const CASE_STATUS_ES: Record<string, string> = {
  received: 'Recibido',
  admitted: 'Admitido',
  transfer: 'Traslado',
  judgment: 'Fallo',
  archived: 'Archivado',
};

const WORD_REVIEW_STATUS_ES: Record<string, string> = {
  pendiente_juez: 'pendiente de juez',
  observaciones_juez: 'con observaciones del juez',
  aprobado_firma_pendiente: 'aprobado (firma pendiente)',
  cerrado_con_pdf_firmado: 'cerrado con PDF firmado',
};

/** Campos que no generan línea en el historial (solo metadatos de sistema). */
const AUDIT_NOISE_KEYS = new Set([
  'updated_at',
  'created_at',
  'id',
  'case_id',
  'created_by',
  'user_id',
]);

const CASE_SKIP_KEYS = new Set(['updated_at', 'raw_text', 'raw_html', 'email_metadata', 'content']);

function payloadRow(
  payload: Record<string, unknown>,
  which: 'old' | 'new',
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
  return name || 'documento sin nombre';
}

function eqJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedKeys(
  oldR: Record<string, unknown>,
  newR: Record<string, unknown>,
  extraSkip: Set<string> = new Set(),
): string[] {
  const keys = new Set([...Object.keys(oldR), ...Object.keys(newR)]);
  const out: string[] = [];
  for (const key of keys) {
    if (AUDIT_NOISE_KEYS.has(key) || extraSkip.has(key)) continue;
    if (!eqJson(oldR[key], newR[key])) out.push(key);
  }
  return out;
}

function joinPhrases(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} y ${clean[1]}`;
  return `${clean.slice(0, -1).join('; ')} y ${clean[clean.length - 1]}`;
}

function textDelta(oldVal: unknown, newVal: unknown, verbs: { add: string; remove: string; edit: string }): string | null {
  const o = str(oldVal).trim();
  const n = str(newVal).trim();
  if (o === n) return null;
  if (!o && n) return verbs.add;
  if (o && !n) return verbs.remove;
  return verbs.edit;
}

function describeCaseFieldChange(key: string, oldVal: unknown, newVal: unknown): string | null {
  switch (key) {
    case 'assigned_to': {
      const o = str(oldVal).trim();
      const n = str(newVal).trim();
      if (!o && n) return `asignó el expediente a «${n}»`;
      if (o && !n) return 'quitó la asignación del sustanciador';
      if (o !== n) return `reasignó el expediente de «${o}» a «${n}»`;
      return null;
    }
    case 'status': {
      const o = CASE_STATUS_ES[str(oldVal)] ?? str(oldVal);
      const n = CASE_STATUS_ES[str(newVal)] ?? str(newVal);
      if (o !== n) return `modificó el estado judicial de «${o}» a «${n}»`;
      return null;
    }
    case 'operational_status':
      if (eqJson(oldVal, newVal)) return null;
      return 'modificó el estado operativo del expediente';
    case 'deadline_at':
    case 'deadline_override_note':
      if (eqJson(oldVal, newVal)) return null;
      return 'modificó el plazo o la nota del término';
    case 'summary':
      if (eqJson(oldVal, newVal)) return null;
      return 'modificó la síntesis procesal del expediente';
    case 'radicado':
      if (str(oldVal) === str(newVal)) return null;
      return 'modificó el radicado del expediente';
    case 'derecho_tutelado_code':
    case 'decision_type':
      if (eqJson(oldVal, newVal)) return null;
      return 'modificó la clasificación o el tipo de decisión (SIERJU)';
    default:
      break;
  }
  if (CASE_SKIP_KEYS.has(key)) return null;
  if (eqJson(oldVal, newVal)) return null;
  return `modificó «${key.replace(/_/g, ' ')}» del expediente`;
}

function describeCasesUpdate(oldR: Record<string, unknown>, newR: Record<string, unknown>): string {
  const parts: string[] = [];
  const keys = new Set([...Object.keys(oldR), ...Object.keys(newR)]);
  for (const key of keys) {
    if (key === 'id') continue;
    const line = describeCaseFieldChange(key, oldR[key], newR[key]);
    if (line) parts.push(line);
  }
  return joinPhrases(parts) || '';
}

function describeCaseActionsRow(r: Record<string, unknown>, operation: CaseAuditLogEntry['operation']): string {
  const typ = str(r.type);
  const desc = str(r.description).trim();
  if (operation === 'DELETE') return 'eliminó una actuación del libro de actuaciones';
  if (operation === 'UPDATE') {
    return desc ? `modificó una actuación: ${desc}` : 'modificó una actuación del libro de actuaciones';
  }
  if (desc) {
    if (typ === 'assignment') return `creó una asignación en actuaciones: ${desc}`;
    if (typ === 'manual_entry') return `creó una actuación manual: ${desc}`;
    if (typ === 'ai_synthesis') return `registró constancia en actuaciones: ${desc}`;
    if (typ === 'status_change') return `registró cambio de estado en actuaciones: ${desc}`;
    if (typ === 'derecho_tutelado_code' || typ === 'decision_type')
      return `registró clasificación en actuaciones: ${desc}`;
    return `creó una actuación: ${desc}`;
  }
  return typ ? `creó una actuación (tipo «${typ}»)` : 'creó una actuación en el libro de actuaciones';
}

function describeWordReviewStatusChange(oldStatus: string, newStatus: string): string {
  if (newStatus === 'cerrado_con_pdf_firmado') {
    return 'firmó y cerró la revisión Word (PDF en expediente)';
  }
  if (newStatus === 'aprobado_firma_pendiente') {
    return 'aprobó el borrador Word (queda pendiente el PDF firmado)';
  }
  if (newStatus === 'observaciones_juez') {
    return 'devolvió el borrador Word al sustanciador con observaciones';
  }
  if (newStatus === 'pendiente_juez' && oldStatus !== 'pendiente_juez') {
    return 'reenvió el borrador Word a revisión del juez';
  }
  const ns = WORD_REVIEW_STATUS_ES[newStatus] ?? newStatus;
  return `modificó el estado de la revisión Word a «${ns}»`;
}

function describeWordReviewUpdate(oldR: Record<string, unknown>, newR: Record<string, unknown>): string {
  const parts: string[] = [];
  const oStatus = str(oldR.status);
  const nStatus = str(newR.status);

  if (oStatus !== nStatus) {
    parts.push(describeWordReviewStatusChange(oStatus, nStatus));
  }

  const signedLine = textDelta(oldR.signed_pdf_document_id, newR.signed_pdf_document_id, {
    add: 'vinculó el PDF firmado a la revisión Word',
    remove: 'quitó el PDF firmado de la revisión Word',
    edit: 'cambió el PDF firmado de la revisión Word',
  });
  if (signedLine) parts.push(signedLine);

  const judgeLine = textDelta(oldR.judge_notes, newR.judge_notes, {
    add: 'escribió observaciones del juez en la revisión Word',
    remove: 'borró las observaciones del juez',
    edit: 'modificó las observaciones del juez en la revisión Word',
  });
  if (judgeLine) parts.push(judgeLine);

  const replyLine = textDelta(oldR.sustanciador_reply, newR.sustanciador_reply, {
    add: 'respondió las observaciones del juez en la revisión Word',
    remove: 'borró la respuesta del sustanciador',
    edit: 'modificó la respuesta del sustanciador en la revisión Word',
  });
  if (replyLine) parts.push(replyLine);

  if (!eqJson(oldR.word_document_id, newR.word_document_id)) {
    parts.push('reemplazó el borrador Word de la revisión');
  }

  if (!eqJson(oldR.review_markup_json, newR.review_markup_json)) {
    parts.push('editó apuntes o comentarios en el borrador Word');
  }

  return joinPhrases(parts);
}

function wordReviewStatusHint(row: Record<string, unknown> | undefined): string | undefined {
  const status = str(row?.status).trim();
  if (!status) return undefined;
  return WORD_REVIEW_STATUS_ES[status] ?? status;
}

function wordReviewRefHint(rowId?: string): string | undefined {
  const id = (rowId ?? '').trim();
  if (!id) return undefined;
  return `ref. ${id.slice(0, 8)}`;
}

function describeWordReview(
  operation: CaseAuditLogEntry['operation'],
  oldR: Record<string, unknown> | undefined,
  newR: Record<string, unknown> | undefined,
  rowId?: string,
): { action: string; hint?: string } {
  if (operation === 'INSERT') {
    return {
      action: 'creó un ciclo de revisión Word',
      hint: wordReviewStatusHint(newR) ?? wordReviewRefHint(rowId),
    };
  }
  if (operation === 'DELETE') {
    return {
      action: 'eliminó un ciclo de revisión Word',
      hint: wordReviewStatusHint(oldR) ?? wordReviewRefHint(rowId),
    };
  }
  if (oldR && newR) {
    const line = describeWordReviewUpdate(oldR, newR);
    if (line) {
      return { action: line, hint: 'revisión Word' };
    }
    const status = wordReviewStatusHint(newR) ?? wordReviewStatusHint(oldR);
    const ref = wordReviewRefHint(rowId);
    return {
      action: 'guardó la revisión Word',
      hint: [status, ref].filter(Boolean).join(' · ') || 'guardado automático',
    };
  }
  return { action: 'modificó la revisión Word', hint: wordReviewRefHint(rowId) };
}

function describeDocumentUpdate(oldR: Record<string, unknown>, newR: Record<string, unknown>): string {
  const name = docDisplayName(newR) || docDisplayName(oldR);
  const parts: string[] = [];

  const moved =
    !eqJson(oldR.sort_order, newR.sort_order) || !eqJson(oldR.notebook_code, newR.notebook_code);
  if (moved) parts.push(`movió «${name}» dentro del expediente digital`);

  if (!eqJson(oldR.name, newR.name) || !eqJson(oldR.original_name, newR.original_name)) {
    const newName = docDisplayName(newR);
    parts.push(`renombró el documento a «${newName}»`);
  }

  const storageLine = textDelta(oldR.storage_path, newR.storage_path, {
    add: `subió el archivo de «${name}» al almacén`,
    remove: `quitó el archivo de «${name}» del almacén`,
    edit: `reemplazó el archivo de «${name}»`,
  });
  if (storageLine) parts.push(storageLine);

  if (!eqJson(oldR.content, newR.content)) {
    parts.push(`modificó el contenido de «${name}»`);
  }

  if (!eqJson(oldR.type, newR.type)) {
    parts.push(`reclasificó «${name}»`);
  }

  if (!eqJson(oldR.sgde_id, newR.sgde_id) || !eqJson(oldR.sgde_sync_status, newR.sgde_sync_status)) {
    parts.push(`vinculó o sincronizó «${name}» con SGDE`);
  }

  if (!eqJson(oldR.file_hash, newR.file_hash)) {
    parts.push(`actualizó el archivo de «${name}» (nueva versión o análisis)`);
  }

  const otherKeys = changedKeys(oldR, newR).filter(
    (k) =>
      ![
        'sort_order',
        'notebook_code',
        'name',
        'original_name',
        'storage_path',
        'content',
        'type',
        'sgde_id',
        'sgde_folder_path',
        'sgde_sync_status',
        'file_hash',
      ].includes(k),
  );
  if (otherKeys.length > 0 && parts.length === 0) {
    parts.push(`modificó «${name}»`);
  }

  return joinPhrases(parts) || `modificó «${name}» en el expediente digital`;
}

function describeUserNotification(
  operation: CaseAuditLogEntry['operation'],
  oldR: Record<string, unknown> | undefined,
  newR: Record<string, unknown> | undefined,
): string {
  if (operation === 'INSERT') {
    const title = str(newR?.title).trim();
    return title ? `creó la notificación «${title}»` : 'creó una notificación interna';
  }
  if (operation === 'DELETE') return 'eliminó una notificación interna';
  const readOld = oldR?.read_at;
  const readNew = newR?.read_at;
  if (!readOld && readNew) return 'marcó como leída una notificación';
  return 'modificó una notificación interna';
}

export type HumanizedAuditKind = 'add' | 'edit' | 'remove' | 'neutral';

export interface HumanizedAuditLine {
  /** Frase narrativa sin nombre de usuario. */
  action: string;
  kind: HumanizedAuditKind;
  hint?: string;
}

/**
 * Convierte una fila de `case_audit_log` en lenguaje claro para el despacho.
 */
export function humanizeCaseAuditEntry(entry: CaseAuditLogEntry): HumanizedAuditLine {
  const table = entry.sourceTable;
  const op = entry.operation;
  const oldR = payloadRow(entry.payload, 'old');
  const newR = payloadRow(entry.payload, 'new');

  if (table === 'case_documents') {
    if (op === 'INSERT') {
      const name = newR ? docDisplayName(newR) : 'un documento';
      return { action: `subió al expediente digital «${name}»`, kind: 'add' };
    }
    if (op === 'DELETE') {
      const name = oldR ? docDisplayName(oldR) : 'un documento';
      return { action: `eliminó del expediente digital «${name}»`, kind: 'remove' };
    }
    if (oldR && newR) {
      return { action: describeDocumentUpdate(oldR, newR), kind: 'edit' };
    }
    const name = newR ? docDisplayName(newR) : oldR ? docDisplayName(oldR) : 'un documento';
    return { action: `modificó «${name}» en el expediente digital`, kind: 'edit' };
  }

  if (table === 'cases') {
    if (op === 'INSERT') return { action: 'creó el expediente en el sistema', kind: 'add', hint: 'alta de caso' };
    if (op === 'DELETE') return { action: 'eliminó el expediente del sistema', kind: 'remove' };
    if (oldR && newR) {
      const action = describeCasesUpdate(oldR, newR);
      return { action: action || 'guardó el expediente', kind: 'edit' };
    }
    return { action: 'modificó datos del expediente', kind: 'edit' };
  }

  if (table === 'case_actions') {
    const row = newR ?? oldR;
    if (row) {
      const action = describeCaseActionsRow(row, op);
      const kind: HumanizedAuditKind =
        op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit';
      return { action, kind, hint: 'libro de actuaciones' };
    }
    return {
      action:
        op === 'DELETE'
          ? 'eliminó una actuación'
          : op === 'INSERT'
            ? 'creó una actuación'
            : 'modificó una actuación',
      kind: op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit',
      hint: 'libro de actuaciones',
    };
  }

  if (table === 'case_word_reviews') {
    const wr = describeWordReview(op, oldR, newR, entry.rowId);
    return {
      action: wr.action,
      kind: op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit',
      hint: wr.hint,
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
    op === 'INSERT' ? 'creó un registro' : op === 'DELETE' ? 'eliminó un registro' : 'modificó un registro';
  return {
    action: `${opEs} en «${table}»`,
    kind: op === 'DELETE' ? 'remove' : op === 'INSERT' ? 'add' : 'edit',
    hint: 'tabla no reconocida; ver JSON',
  };
}
