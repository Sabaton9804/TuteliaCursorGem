import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const CASE_DOCUMENTS_BUCKET = 'case-documents';
export const DEFAULT_NOTEBOOK_CODE = 'PI_C01_PRINCIPAL';

/** Colapsa `nombre.pdf.pdf` → `nombre.pdf` (bug frecuente al concatenar `.pdf` sobre un name ya tipado). */
export function ensureSinglePdfExtension(raw: string, fallback = 'documento.pdf'): string {
  const fb = (fallback || 'documento.pdf').trim() || 'documento.pdf';
  let t = (raw || '').trim();
  if (!t) t = fb;
  t = t.replace(/(\.pdf)+$/i, '');
  t = t.replace(/\.+$/, '');
  if (!t) t = fb.replace(/(\.pdf)+$/i, '').replace(/\.+$/, '') || 'documento';
  return `${t}.pdf`;
}

export function sanitizeCaseDocumentLogicalName(raw: string, fallback: string): string {
  const fb = ensureSinglePdfExtension(fallback || 'documento.pdf', 'documento.pdf');
  let t = (raw || '').trim();
  if (!t) return fb;
  // Evitar InformeIngresoDespacho.pdf.pdf si el caller ya traía .pdf
  t = t.replace(/(\.pdf)+$/i, '.pdf');
  if (!/\.pdf$/i.test(t)) t = `${t.replace(/\.+$/, '')}.pdf`;
  const safe = t
    .replace(/[/\\]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
  const out = ensureSinglePdfExtension(safe, fb);
  return out || fb;
}

export function buildCaseAttachmentObjectPath(caseId: string, logicalName: string): string {
  const safe = sanitizeCaseDocumentLogicalName(logicalName, 'documento.pdf');
  return `cases/${caseId}/${randomUUID()}_${safe}`;
}

export async function uploadCaseAttachmentAdmin(
  admin: SupabaseClient,
  caseId: string,
  logicalName: string,
  body: Buffer,
  contentType: string
): Promise<{ path: string } | { error: Error }> {
  const path = buildCaseAttachmentObjectPath(caseId, logicalName);
  const { error } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).upload(path, body, {
    contentType: contentType || 'application/octet-stream',
    upsert: false,
  });
  if (error) return { error: new Error(error.message) };
  return { path };
}

export async function removeCaseDocumentObjectsAdmin(
  admin: SupabaseClient,
  paths: string[]
): Promise<void> {
  if (!paths.length) return;
  const { error } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).remove(paths);
  if (error) console.error('[storage] remove:', error.message);
}

function isMissingColumn(err: unknown, column: string): boolean {
  const msg = String(err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : err);
  return new RegExp(column, 'i').test(msg) && (/schema cache/i.test(msg) || /could not find the/i.test(msg));
}

function stripOptionalDocColumns(
  rows: Array<Record<string, unknown>>,
  keys: string[]
): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) delete out[k];
    return out;
  });
}

export async function insertCaseDocumentRowsAdmin(
  admin: SupabaseClient,
  rows: Array<Record<string, unknown>>
) {
  const optionalKeys = [
    'notebook_code',
    'sgde_id',
    'sgde_folder_path',
    'sgde_sync_status',
    'act_code',
    'act_sequence',
    'party_entity',
    'source_channel',
  ];
  let payload = rows;
  let res = await admin.from('case_documents').insert(payload);
  while (res.error) {
    const missing = optionalKeys.find((k) => isMissingColumn(res.error, k));
    if (!missing) break;
    const idx = optionalKeys.indexOf(missing);
    payload = stripOptionalDocColumns(rows, optionalKeys.slice(idx));
    res = await admin.from('case_documents').insert(payload);
  }
  return res;
}

export async function nextSortOrderForCase(
  admin: SupabaseClient,
  caseId: string,
  notebookCode = DEFAULT_NOTEBOOK_CODE
): Promise<number> {
  const { data, error } = await admin
    .from('case_documents')
    .select('sort_order, notebook_code')
    .eq('case_id', caseId);
  if (error || !data?.length) return 0;
  const max = data
    .filter((r) => String((r as { notebook_code?: string }).notebook_code || DEFAULT_NOTEBOOK_CODE) === notebookCode)
    .reduce((m, r) => Math.max(m, Number((r as { sort_order?: number }).sort_order ?? 0)), -1);
  return max + 1;
}
