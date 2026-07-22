/**
 * Elimina el caso 2026-00385 creado por error (radicación duplicada / SGDE mezclado).
 * Uso: npx tsx scripts/delete-case-385-2026.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { CASE_DOCUMENTS_BUCKET } from '../server/case-document-storage.ts';

/** Juan David Montoya / CNSC — radicado 11001310305120260038500 (22 jul 2026). */
const CASE_ID = 'c7df878e-bc26-4169-86f2-412386f9c9ae';
const EXPECTED_RADICADO = '11001310305120260038500';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const n of ['.env', '.env.local'] as const) {
  const f = path.join(root, n);
  if (fs.existsSync(f)) dotenv.config({ path: f });
}

const url = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) throw new Error('Faltan credenciales Supabase');

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: caseRow } = await admin
  .from('cases')
  .select('id, radicado, claimant, defendant, created_at')
  .eq('id', CASE_ID)
  .maybeSingle();

if (!caseRow?.id) {
  console.log('El caso 2026-385 ya no existe en Tutelia.');
  process.exit(0);
}

const radDigits = String(caseRow.radicado || '').replace(/\D/g, '');
if (radDigits !== EXPECTED_RADICADO) {
  throw new Error(
    `Abortado: el id ${CASE_ID} tiene radicado ${caseRow.radicado}, se esperaba ${EXPECTED_RADICADO}.`,
  );
}

console.log('Eliminando caso erróneo:', caseRow);

const { data: docs } = await admin
  .from('case_documents')
  .select('storage_path')
  .eq('case_id', CASE_ID);

const storagePaths = (docs || [])
  .map((d) => String(d.storage_path || '').trim())
  .filter(Boolean);

if (storagePaths.length > 0) {
  const { error: stErr } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).remove(storagePaths);
  if (stErr) console.warn('Storage:', stErr.message);
  else console.log(`Storage: ${storagePaths.length} archivo(s) borrado(s).`);
}

const databaseUrl = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl || databaseUrl.startsWith('prisma+')) {
  throw new Error('Falta DIRECT_URL o DATABASE_URL (postgres) en .env para borrar el caso.');
}

function stripSslMode(raw: string): string {
  const u = new URL(raw);
  u.searchParams.delete('sslmode');
  return u.toString();
}

const pgClient = new pg.Client({
  connectionString: stripSslMode(databaseUrl),
  ssl: { rejectUnauthorized: false },
});
await pgClient.connect();

try {
  await pgClient.query('BEGIN');
  await pgClient.query('ALTER TABLE public.cases DISABLE TRIGGER cases_audit_trg');
  await pgClient.query('DELETE FROM public.case_sgde_folder_map WHERE case_id = $1', [CASE_ID]);
  await pgClient.query('DELETE FROM public.case_audit_log WHERE case_id = $1', [CASE_ID]);
  await pgClient.query('DELETE FROM public.user_notifications WHERE case_id = $1', [CASE_ID]);
  await pgClient.query('DELETE FROM public.workflow_tasks WHERE case_id = $1', [CASE_ID]);
  await pgClient.query('DELETE FROM public.case_stages WHERE case_id = $1', [CASE_ID]);
  await pgClient.query('DELETE FROM public.case_actions WHERE case_id = $1', [CASE_ID]);
  await pgClient.query('DELETE FROM public.case_documents WHERE case_id = $1', [CASE_ID]);
  const del = await pgClient.query('DELETE FROM public.cases WHERE id = $1 RETURNING radicado', [CASE_ID]);
  await pgClient.query('ALTER TABLE public.cases ENABLE TRIGGER cases_audit_trg');
  await pgClient.query('COMMIT');
  console.log('BD:', del.rowCount ? `caso ${del.rows[0]?.radicado} eliminado` : 'sin filas');
} catch (e) {
  await pgClient.query('ROLLBACK');
  try {
    await pgClient.query('ALTER TABLE public.cases ENABLE TRIGGER cases_audit_trg');
  } catch {
    /* ignore */
  }
  throw e;
} finally {
  await pgClient.end().catch(() => undefined);
}

const { data: check } = await admin.from('cases').select('id').eq('id', CASE_ID).maybeSingle();
console.log(check ? 'ERROR: el caso sigue en BD' : 'OK: caso 2026-385 eliminado. El 2025-385 archivado se conserva.');
