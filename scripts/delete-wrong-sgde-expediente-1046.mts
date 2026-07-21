/**
 * Elimina el expediente SGDE creado por error en el 1046 (radicado …04601 en bandeja J51)
 * y revierte en Tutelia los vínculos SGDE de Impugnación.
 *
 * Uso: npx tsx scripts/delete-wrong-sgde-expediente-1046.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client.ts';
import { decryptSgdePassword } from '../server/sgde-crypto.ts';

const CASE_ID = '9c64cc8b-9b67-42f0-9356-9cf62b1ef9c0';
const WRONG_SGDE_ROOT = '8ac0cfec-4d81-4524-8302-1f4e4a2087fd';
const ORIGIN_SGDE_ROOT = 'b36709bf-9a20-48e3-b1ba-fd628046e007';
const NOTEBOOK_SI_IMPUGNACION = 'SI_IMPUGNACION';

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

function nodeIdFromEntry(entry: Record<string, unknown>): string {
  return String(entry.id || entry.nodeId || entry.uuid || '')
    .trim()
    .toLowerCase();
}

async function deleteNodeDeep(client: SgdeClient, nodeId: string, depth = 0): Promise<void> {
  const children = await client.fetchChildren(nodeId);
  for (const raw of children) {
    const ent = raw as Record<string, unknown>;
    const childId = nodeIdFromEntry(ent);
    if (!childId) continue;
    await deleteNodeDeep(client, childId, depth + 1);
  }
  const del = await client.deleteDocumentNode(nodeId);
  const pad = '  '.repeat(depth);
  if (del.ok) console.log(`${pad}✓ Borrado ${nodeId.slice(0, 8)}…`);
  else console.warn(`${pad}✗ No se pudo borrar ${nodeId}: ${del.error}`);
}

async function sgdeClientFromDb(admin: ReturnType<typeof createClient>): Promise<SgdeClient> {
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
    decryptSgdePassword(String(credRow.password_ciphertext)),
  );
  const login = await client.login();
  if (login.ok === false) throw new Error(`Login SGDE: ${login.message}`);
  return client;
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caseRow } = await admin
    .from('cases')
    .select('id, sgde_id, origin_radicado, radicado')
    .eq('id', CASE_ID)
    .single();

  console.log('Caso actual:', caseRow);

  const client = await sgdeClientFromDb(admin);

  console.log(`\nBorrando expediente SGDE incorrecto ${WRONG_SGDE_ROOT}…`);
  await deleteNodeDeep(client, WRONG_SGDE_ROOT);

  const verify = await client.buscarExpedienteNodeId(
    String(caseRow?.radicado || '').replace(/\D/g, '').slice(0, 23),
  );
  if (verify === WRONG_SGDE_ROOT) {
    console.warn('El nodo incorrecto sigue indexado por radicado 2ª; puede tardar en desaparecer del índice SGDE.');
  } else {
    console.log('Radicado 2ª ya no apunta al nodo incorrecto.');
  }

  console.log('\nRevirtiendo Tutelia…');

  await admin
    .from('cases')
    .update({
      sgde_id: ORIGIN_SGDE_ROOT,
      sgde_sync_status: 'linked',
      updated_at: new Date().toISOString(),
    })
    .eq('id', CASE_ID);

  await admin.from('case_sgde_folder_map').delete().eq('case_id', CASE_ID).eq('notebook_code', NOTEBOOK_SI_IMPUGNACION);

  const { data: impugnacionDocs } = await admin
    .from('case_documents')
    .select('id, name, sgde_id')
    .eq('case_id', CASE_ID)
    .eq('notebook_code', NOTEBOOK_SI_IMPUGNACION);

  for (const doc of impugnacionDocs || []) {
    await admin
      .from('case_documents')
      .update({
        sgde_id: null,
        sgde_sync_status: 'local_only',
        sgde_folder_path: 'Segunda instancia / Impugnación',
        updated_at: new Date().toISOString(),
      })
      .eq('id', doc.id);
    console.log(`  Doc ${doc.name}: sgde_id limpiado (local_only)`);
  }

  console.log('\nListo. Expediente incorrecto eliminado; caso enlazado al PI', ORIGIN_SGDE_ROOT.slice(0, 8) + '…');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
