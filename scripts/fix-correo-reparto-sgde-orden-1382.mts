/**
 * Corrige orden SGDE de CorreoReparto en Impugnación (caso 2026-1382):
 * elimina el nodo con orden 18 y lo vuelve a subir con orden 2.
 *
 * Uso: npx tsx scripts/fix-correo-reparto-sgde-orden-1382.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';
import {
  buildSgdeExpedienteProperties,
  tipoDocumentalSgdeSegundaFromFileName,
} from '../server/sgde-tutela-metadata';
import { CASE_DOCUMENTS_BUCKET, sanitizeCaseDocumentLogicalName } from '../server/case-document-storage';

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

const RADICADO = '11001418909020260138201';
const SGDE_IMPUGNACION_PATH = 'Segunda instancia / Impugnación';
const TARGET_ORDEN = 2;

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

async function main() {
  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('id, radicado, claimant, defendant, court_id, sgde_id')
    .eq('radicado', RADICADO)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow?.id) throw new Error(`Caso no encontrado: ${RADICADO}`);

  const caseId = String(caseRow.id);
  const radicado23 = String(caseRow.radicado).replace(/\D/g, '').slice(0, 23);

  const { data: courtRow } = await admin
    .from('courts')
    .select('name')
    .eq('id', caseRow.court_id)
    .maybeSingle();

  const { data: docRow, error: docErr } = await admin
    .from('case_documents')
    .select('id, name, type, storage_path, sgde_id, act_code')
    .eq('case_id', caseId)
    .eq('name', 'CorreoReparto')
    .maybeSingle();
  if (docErr) throw docErr;
  if (!docRow?.storage_path) throw new Error('CorreoReparto sin storage_path en Tutelia');

  const { data: credRow, error: credErr } = await admin
    .from('sgde_credentials')
    .select('username, password_ciphertext')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (credErr) throw credErr;
  if (!credRow?.username || !credRow?.password_ciphertext) {
    throw new Error('Sin credenciales SGDE en BD');
  }

  const client = new SgdeClient(getDefaultSgdeBaseUrl());
  client.setCredentials(
    String(credRow.username).trim(),
    decryptSgdePassword(String(credRow.password_ciphertext))
  );
  const login = await client.login();
  if (login.ok === false) throw new Error(`Login SGDE: ${login.message}`);

  let sgdeRootId = String(caseRow.sgde_id || '').trim();
  if (!sgdeRootId) {
    sgdeRootId = (await client.buscarExpedienteNodeId(radicado23)) || '';
  }
  if (!sgdeRootId) throw new Error('Expediente no encontrado en SGDE');

  const folders = await client.ensureSegundaInstanciaImpugnacion(sgdeRootId);
  if (folders.ok === false) throw new Error(folders.error);

  const leaves = await client.collectPdfLeavesForExpediente(sgdeRootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado: radicado23,
  });

  const impugnLeaves = leaves.filter((l) =>
    String(l.folderPath || '').toLowerCase().includes('impugn')
  );
  console.log('PDF en Impugnación:');
  for (const l of impugnLeaves) {
    console.log(`  - ${l.name} | orden=${l.orden ?? '?'} | id=${l.id}`);
  }

  const correoLeaves = impugnLeaves.filter(
    (l) => normalizeKey(l.name) === 'correoreparto' || normalizeKey(l.name).startsWith('correoreparto')
  );

  const toDelete = correoLeaves.length > 0 ? correoLeaves : [];
  if (docRow.sgde_id) {
    const byId = impugnLeaves.find((l) => l.id.toLowerCase() === String(docRow.sgde_id).toLowerCase());
    if (byId && !toDelete.some((x) => x.id === byId.id)) toDelete.push(byId);
  }

  for (const leaf of toDelete) {
    console.log(`Eliminando SGDE: ${leaf.name} (${leaf.id}) orden=${leaf.orden}`);
    const del = await client.deleteDocumentNode(leaf.id);
    if (del.ok === false) throw new Error(`No se pudo eliminar ${leaf.name}: ${del.error}`);
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from(CASE_DOCUMENTS_BUCKET)
    .download(String(docRow.storage_path));
  if (dlErr || !blob) throw new Error(`No se leyó PDF de Storage: ${dlErr?.message}`);

  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length < 100) throw new Error('PDF vacío en Storage');

  const props = buildSgdeExpedienteProperties({
    radicado23,
    claimant: String(caseRow.claimant || ''),
    defendant: String(caseRow.defendant || ''),
    courtName: courtRow?.name ? String(courtRow.name) : undefined,
  });

  const fileName = sanitizeCaseDocumentLogicalName('CorreoReparto', 'CorreoReparto.pdf');
  const tipo = tipoDocumentalSgdeSegundaFromFileName(
    String(docRow.name),
    String(docRow.type),
    docRow.act_code ? String(docRow.act_code) : null
  );

  console.log(`Subiendo CorreoReparto con orden ${TARGET_ORDEN}…`);
  const up = await client.uploadDocumentToFolder({
    folderNodeUuid: folders.impugnacionFolderId,
    radicado23,
    buffer: buf,
    fileName,
    contentType: 'application/pdf',
    tipoDocumental: tipo,
    expedienteMetadata: props,
    orden: TARGET_ORDEN,
  });
  if (up.ok === false) throw new Error(up.error);

  await admin
    .from('case_documents')
    .update({
      sgde_id: up.sgdeDocId || null,
      sgde_folder_path: SGDE_IMPUGNACION_PATH,
      sgde_sync_status: 'linked',
      error: null,
    })
    .eq('id', docRow.id);

  await admin
    .from('cases')
    .update({ sgde_id: sgdeRootId, sgde_sync_status: 'linked', updated_at: new Date().toISOString() })
    .eq('id', caseId);

  const after = await client.collectPdfLeavesForExpediente(sgdeRootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado: radicado23,
  });
  console.log('\nImpugnación tras corrección:');
  for (const l of after.filter((x) => String(x.folderPath || '').toLowerCase().includes('impugn'))) {
    console.log(`  - ${l.name} | orden=${l.orden ?? '?'}`);
  }
  console.log('\nOK — CorreoReparto reindexado en SGDE.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
