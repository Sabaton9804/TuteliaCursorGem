import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Huérfanos: borrar un `cases` / `case_documents` en Postgres no elimina el objeto en Storage.
 * Patrón pro a futuro: Edge Function + Database Webhook (p. ej. DELETE en `case_documents`)
 * o job que compare `storage_path` con filas vivas y haga `storage.remove`.
 */

/** Debe coincidir con `storage.buckets.id` en la migración SQL. */
export const CASE_DOCUMENTS_BUCKET = 'case-documents';

/**
 * TTL de `createSignedUrl` para el visor (segundos).
 * Ventana corta (15–30 min): basta para leer el PDF; el enlace filtrado deja de valer pronto.
 */
export const CASE_DOCUMENT_SIGNED_URL_TTL_SEC = 30 * 60;

const ALLOWED_STORAGE_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'tif',
  'tiff',
  'mp3',
  'mpeg',
  'mpg',
]);

function normalizeStorageExtension(rawExt: string | undefined, fallback = 'pdf'): string {
  const ext = (rawExt || fallback).toLowerCase().replace(/^\./, '');
  return ALLOWED_STORAGE_EXTENSIONS.has(ext) ? ext : fallback;
}

/**
 * Nombre lógico para `case_documents` / Storage: mismo criterio que la ruta del objeto (sin barras, longitud acotada).
 * Conserva la extensión original (PDF, Word, imagen, etc.). Si falta extensión, usa `fallback`.
 */
export function sanitizeCaseDocumentLogicalName(raw: string, fallback: string): string {
  const fb = (fallback || 'documento.pdf').trim() || 'documento.pdf';
  let t = (raw || '').trim();
  if (!t) return fb;
  const extMatch = t.match(/\.([a-zA-Z0-9]{1,8})$/);
  const ext = normalizeStorageExtension(extMatch?.[1], normalizeStorageExtension(fb.split('.').pop()));
  const base = (extMatch ? t.slice(0, -extMatch[0].length) : t).replace(/\.+$/, '');
  const safeBase = base
    .replace(/[/\\]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
  const out = safeBase ? `${safeBase}.${ext}` : fb;
  return out || fb;
}

export function buildCaseAttachmentObjectPath(caseId: string, logicalName: string): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const safe = sanitizeCaseDocumentLogicalName(logicalName, 'documento.pdf');
  return `cases/${caseId}/${id}_${safe}`;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function uploadCaseAttachment(
  supabase: SupabaseClient,
  caseId: string,
  logicalName: string,
  body: Uint8Array | ArrayBuffer,
  contentType: string
): Promise<{ path: string } | { error: Error }> {
  const path = buildCaseAttachmentObjectPath(caseId, logicalName);
  const { error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).upload(path, body, {
    contentType: contentType || 'application/octet-stream',
    upsert: false,
  });
  if (error) return { error: new Error(error.message) };
  return { path };
}

export async function removeCaseDocumentObjects(
  supabase: SupabaseClient,
  paths: string[]
): Promise<boolean> {
  if (paths.length === 0) return true;
  const { error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).remove(paths);
  if (error) {
    console.error('Storage remove:', error.message);
    return false;
  }
  return true;
}

/** PostgREST cuando el proyecto no tiene la columna (migración no aplicada). */
export function isMissingCaseDocumentsNotebookColumnError(err: unknown): boolean {
  const msg = String(
    err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : err
  );
  return /notebook_code/i.test(msg) && (/schema cache/i.test(msg) || /could not find the/i.test(msg));
}

export function isMissingCaseDocumentsActColumnError(err: unknown): boolean {
  const msg = String(
    err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : err
  );
  return /act_code|act_sequence|party_entity|source_channel/i.test(msg) && (/schema cache/i.test(msg) || /could not find the/i.test(msg));
}

export function caseDocumentRowsWithoutOptionalColumns(
  rows: Array<Record<string, unknown>>,
  keys: string[],
): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) delete out[k];
    return out;
  });
}

export function caseDocumentRowsWithoutNotebookCode(
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return rows.map((r) => {
    const { notebook_code: _omit, ...rest } = r;
    return rest;
  });
}

/**
 * Inserta filas en `case_documents`. Si la BD aún no tiene `notebook_code`, reintenta sin esa clave
 * (la app sigue funcionando; para cuadernos por columna ejecute la migración SQL).
 */
export async function insertCaseDocumentRows(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>
) {
  const actKeys = ['act_code', 'act_sequence', 'party_entity', 'source_channel'];
  let res = await supabase.from('case_documents').insert(rows);
  if (!res.error) return res;

  if (isMissingCaseDocumentsActColumnError(res.error)) {
    res = await supabase
      .from('case_documents')
      .insert(caseDocumentRowsWithoutOptionalColumns(rows, actKeys));
    if (!res.error) return res;
  }

  if (isMissingCaseDocumentsNotebookColumnError(res.error)) {
    console.warn(
      '[case_documents] Sin columna notebook_code; insert sin ese campo. Aplique migración SQL de cuadernos.'
    );
    return supabase.from('case_documents').insert(caseDocumentRowsWithoutNotebookCode(rows));
  }

  if (res.error) {
    const stripped = caseDocumentRowsWithoutNotebookCode(
      caseDocumentRowsWithoutOptionalColumns(rows, actKeys),
    );
    return supabase.from('case_documents').insert(stripped);
  }

  return res;
}

/** Inserta una fila y devuelve su `id` (p. ej. informe de ingreso al expediente). */
export async function insertCaseDocumentRowReturningId(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<{ id: string }> {
  const first = await supabase.from('case_documents').insert([row]).select('id').maybeSingle();
  if (first.error && isMissingCaseDocumentsNotebookColumnError(first.error)) {
    const fallbackRows = caseDocumentRowsWithoutNotebookCode([row]);
    const second = await supabase.from('case_documents').insert(fallbackRows).select('id').maybeSingle();
    if (second.error) throw second.error;
    if (!second.data?.id) throw new Error('No se obtuvo id de case_documents tras insertar.');
    return { id: String(second.data.id) };
  }
  if (first.error) throw first.error;
  if (!first.data?.id) throw new Error('No se obtuvo id de case_documents tras insertar.');
  return { id: String(first.data.id) };
}
