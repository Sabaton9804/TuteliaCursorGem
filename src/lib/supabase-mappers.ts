import type { Action, Case, CaseStatus, Document, UserProfile } from '../types';
import { parseUserRole } from './user-roles';

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
    sgdeId: row.sgde_id ? String(row.sgde_id) : undefined,
    sourceChannel: row.source_channel ? String(row.source_channel) : undefined,
    summary: row.summary ? String(row.summary) : undefined,
    claimantId: row.claimant_id ? String(row.claimant_id) : undefined,
    claimantEmail: row.claimant_email ? String(row.claimant_email) : undefined,
    defendantId: row.defendant_id ? String(row.defendant_id) : undefined,
    defendantEmail: row.defendant_email ? String(row.defendant_email) : undefined,
    legalHechos: row.legal_hechos ? String(row.legal_hechos) : undefined,
    legalPretensiones: row.legal_pretensiones ? String(row.legal_pretensiones) : undefined,
    legalDerechoTutelado: row.legal_derecho_tutelado ? String(row.legal_derecho_tutelado) : undefined,
    legalIdentificaciones: row.legal_identificaciones ? String(row.legal_identificaciones) : undefined,
    subject: row.subject ? String(row.subject) : undefined,
    rawText: row.raw_text ? String(row.raw_text) : undefined,
    rawHtml: row.raw_html ? String(row.raw_html) : undefined,
    emailMetadata: (row.email_metadata as Record<string, unknown>) || undefined,
    expedienteCuadernosExtra: parseExpedienteCuadernosExtra(row.expediente_cuadernos_extra),
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
    createdAt: typeof row.created_at === 'string' ? row.created_at : String(row.created_at ?? ''),
    content: row.content ? String(row.content) : undefined,
    contentType: row.content_type ? String(row.content_type) : undefined,
    size: typeof row.size === 'number' ? row.size : row.size != null ? Number(row.size) : undefined,
    originalName: row.original_name ? String(row.original_name) : undefined,
    order: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order ?? 0),
    isFromLink: Boolean(row.is_from_link),
    ingestError: row.error ? String(row.error) : undefined,
    notebookCode: row.notebook_code ? String(row.notebook_code) : 'PI_C01_PRINCIPAL',
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

export function rowToUserProfile(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    name: String(row.name ?? ''),
    role: parseUserRole(row.role),
    courtId: String(row.court_id ?? 'court-1'),
  };
}
