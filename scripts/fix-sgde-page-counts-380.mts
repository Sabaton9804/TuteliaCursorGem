/**
 * Corrige foliación correlativa (paginas / inicio / fin) en los PDFs del radicado 380
 * ya subidos a SGDE, contando páginas reales desde Storage y sumando en orden.
 *
 * Uso: npx tsx scripts/fix-sgde-page-counts-380.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';
import { CASE_DOCUMENTS_BUCKET } from '../server/case-document-storage';
import { countPdfPagesInBuffer } from '../pdf-acta-detect.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(fs.readFileSync(full, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      const t = String(v).trim();
      if (t) merged[k] = t;
    }
  }
  return merged;
}

const env = loadEnv();
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const CASE_ID = '9dbd9f05-2a52-410f-b898-22c9a23a5914';
const EXP_SGDE_ID = '611096a0-06a0-4df8-bd8e-a0b3bc8e6bbf';

async function main() {
  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan credenciales Supabase');

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: credRow, error: credErr } = await admin
    .from('sgde_credentials')
    .select('username, password_ciphertext')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (credErr) throw credErr;
  if (!credRow?.username || !credRow?.password_ciphertext) {
    throw new Error('Sin credenciales SGDE en BD.');
  }

  const { data: docs, error: docsErr } = await admin
    .from('case_documents')
    .select('id, name, sgde_id, storage_path')
    .eq('case_id', CASE_ID)
    .not('sgde_id', 'is', null);
  if (docsErr) throw docsErr;
  if (!docs?.length) throw new Error('No hay documentos con sgde_id en el caso 380.');

  const bySgdeId = new Map(
    docs.map((d) => [String(d.sgde_id || '').trim().toLowerCase(), d] as const),
  );

  const client = new SgdeClient(getDefaultSgdeBaseUrl());
  client.setCredentials(
    String(credRow.username).trim(),
    decryptSgdePassword(String(credRow.password_ciphertext)),
  );
  const login = await client.login();
  if (login.ok === false) throw new Error(`Login SGDE: ${login.message}`);

  const folders = await client.ensurePrimeraInstanciaPrincipal(EXP_SGDE_ID);
  if (!folders.ok) throw new Error(folders.error);

  const children = await client.fetchChildren(folders.principalFolderId);
  type Row = { sgdeId: string; name: string; orden: number; storagePath: string; pages: number };
  const rows: Row[] = [];

  for (const ch of children) {
    const nodeType = String(ch.nodeType || '');
    const isFolder = Boolean(ch.isFolder) || nodeType.includes('folder');
    if (isFolder) continue;
    const sgdeId = String(ch.id || '')
      .trim()
      .toLowerCase();
    const props = (ch.properties as Record<string, unknown> | undefined) || {};
    const orden = Number(props['rama:idDocumento'] ?? 0) || 0;
    const local = bySgdeId.get(sgdeId);
    if (!local?.storage_path) {
      console.warn(`SKIP ${ch.name}: sin storage_path en Tutelia`);
      continue;
    }
    const { data: blob, error: dlErr } = await admin.storage
      .from(CASE_DOCUMENTS_BUCKET)
      .download(String(local.storage_path));
    if (dlErr || !blob) {
      console.error(`FAIL ${local.name}: download ${dlErr?.message || 'sin blob'}`);
      continue;
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    const pages = (await countPdfPagesInBuffer(buf)) ?? 1;
    rows.push({
      sgdeId,
      name: String(local.name || ch.name || ''),
      orden,
      storagePath: String(local.storage_path),
      pages: Math.max(1, pages),
    });
  }

  rows.sort((a, b) => a.orden - b.orden || a.name.localeCompare(b.name, 'es'));

  let nextStart = 1;
  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const ini = nextStart;
    const fin = ini + row.pages - 1;
    console.log(`#${row.orden} ${row.name}: ${row.pages} pág → ${ini}-${fin}`);
    const res = await client.updateDocumentPageCount(row.sgdeId, row.pages, ini);
    if (res.ok) {
      ok += 1;
      console.log('  OK');
    } else {
      fail += 1;
      console.error(`  FAIL ${res.error}`);
    }
    nextStart = fin + 1;
  }

  console.log(`\nListo: ${ok} corregidos, ${fail} fallos. Última página del cuaderno: ${nextStart - 1}.`);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
