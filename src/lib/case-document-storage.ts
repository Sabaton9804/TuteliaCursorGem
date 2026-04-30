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

/**
 * Nombre lógico para `case_documents` / Storage: mismo criterio que la ruta del objeto (sin barras, longitud acotada).
 * Añade `.pdf` si falta. Si tras sanear queda vacío, usa `fallback`.
 */
export function sanitizeCaseDocumentLogicalName(raw: string, fallback: string): string {
  const fb = (fallback || 'documento.pdf').trim() || 'documento.pdf';
  let t = (raw || '').trim();
  if (!t) return fb.endsWith('.pdf') ? fb : `${fb.replace(/\.+$/, '')}.pdf`;
  if (!/\.pdf$/i.test(t)) t = `${t.replace(/\.+$/, '')}.pdf`;
  const safe = t
    .replace(/[/\\]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
  const out = safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
  return out || (fb.toLowerCase().endsWith('.pdf') ? fb : `${fb}.pdf`);
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
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).remove(paths);
  if (error) console.error('Storage remove:', error.message);
}

/** PostgREST cuando el proyecto no tiene la columna (migración no aplicada). */
export function isMissingCaseDocumentsNotebookColumnError(err: unknown): boolean {
  const msg = String(
    err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : err
  );
  return /notebook_code/i.test(msg) && (/schema cache/i.test(msg) || /could not find the/i.test(msg));
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
  const first = await supabase.from('case_documents').insert(rows);
  if (first.error && isMissingCaseDocumentsNotebookColumnError(first.error)) {
    console.warn(
      '[case_documents] Sin columna notebook_code en el proyecto Supabase; insert sin ese campo. ' +
        'Aplique supabase/migrations/20250428160000_case_documents_notebook.sql en SQL Editor para activar cuadernos en BD.'
    );
    return supabase.from('case_documents').insert(caseDocumentRowsWithoutNotebookCode(rows));
  }
  return first;
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
