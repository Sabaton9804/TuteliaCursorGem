/**
 * Limpieza total SGDE J51 caso 1046:
 * - Borra expediente propio J51 (radicado …04601) si aún existe
 * - Borra nodos huérfanos de subidas erróneas
 * - Deja intactos los PDF de PI migrados (expediente compartido origen)
 * - Tutelia: Impugnación vuelve a local_only
 *
 * Uso: npx tsx scripts/cleanup-sgde-j51-1046.mts
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
const RADICADO_SEGUNDA = '11001418904720260104601';
const RADICADO_ORIGEN = '11001418904720260104600';
const NOTEBOOK_SI_IMPUGNACION = 'SI_IMPUGNACION';

/** Nodos subidos al expediente J51 erróneo (delete previo). */
const J51_UPLOAD_NODE_IDS = new Set([
  '7c858677-b92f-43e6-981e-afd08e4adafe',
  'afc74d2e-fb00-491d-b5b1-6ac19e8707bf',
  'cb818b86-650f-4af9-bbdc-b6fd1c8be6ea',
  'ebd1658d-e6b3-43cf-9b0f-ca643aeffaa8',
  '1276ca34-0000-0000-0000-000000000000', // placeholder - will filter by prefix
]);

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

async function deleteNodeDeep(client: SgdeClient, nodeId: string, depth = 0): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(nodeId)) return false;
  try {
    const children = await client.fetchChildren(nodeId);
    for (const raw of children) {
      const childId = nodeIdFromEntry(raw as Record<string, unknown>);
      if (childId) await deleteNodeDeep(client, childId, depth + 1);
    }
  } catch {
    /* nodo ya no existe */
  }
  const del = await client.deleteDocumentNode(nodeId);
  const pad = '  '.repeat(depth);
  if (del.ok) {
    console.log(`${pad}✓ Borrado ${nodeId.slice(0, 8)}…`);
    return true;
  }
  if (/404|not found/i.test(del.error)) {
    console.log(`${pad}· Ya no existe ${nodeId.slice(0, 8)}…`);
    return true;
  }
  console.warn(`${pad}✗ ${nodeId.slice(0, 8)}…: ${del.error}`);
  return false;
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

  const { data: docs } = await admin
    .from('case_documents')
    .select('id, name, notebook_code, sgde_id, sgde_sync_status')
    .eq('case_id', CASE_ID);

  const j51DocIds = (docs || [])
    .filter(
      (d) =>
        d.notebook_code === NOTEBOOK_SI_IMPUGNACION ||
        /^informeingreso/i.test(String(d.name || '')) ||
        (d.sgde_id && J51_UPLOAD_NODE_IDS.has(String(d.sgde_id).toLowerCase())),
    )
    .map((d) => d.id);

  console.log('Piezas J51 a desvincular en Tutelia:', (docs || []).filter((d) => j51DocIds.includes(d.id)).map((d) => d.name));

  let client: SgdeClient | null = null;
  try {
    client = await sgdeClientFromDb(admin);
  } catch (e) {
    console.warn('SGDE login falló; solo limpieza Tutelia:', e);
  }

  if (client) {
    console.log(`\n1) Borrar expediente J51 erróneo ${WRONG_SGDE_ROOT}…`);
    await deleteNodeDeep(client, WRONG_SGDE_ROOT);

    console.log('\n2) Buscar expediente por radicado 2ª …04601…');
    const found04601 = await client.buscarExpedienteNodeId(RADICADO_SEGUNDA);
    if (found04601 && found04601 !== ORIGIN_SGDE_ROOT) {
      console.log(`   Encontrado nodo ${found04601} — borrando…`);
      await deleteNodeDeep(client, found04601);
    } else if (found04601 === ORIGIN_SGDE_ROOT) {
      console.log('   Búsqueda 04601 devolvió expediente origen (compartido PI); no se borra.');
    } else {
      console.log('   Sin expediente J51 con radicado 04601.');
    }

    console.log('\n3) Borrar nodos huérfanos de subidas J51…');
    for (const nodeId of J51_UPLOAD_NODE_IDS) {
      if (!/^[0-9a-f-]{36}$/.test(nodeId)) continue;
      await deleteNodeDeep(client, nodeId);
    }

    const orphanSgdeIds = (docs || [])
      .map((d) => String(d.sgde_id || '').trim().toLowerCase())
      .filter((id) => J51_UPLOAD_NODE_IDS.has(id));
    for (const nodeId of new Set(orphanSgdeIds)) {
      await deleteNodeDeep(client, nodeId);
    }
  }

  console.log('\n4) Tutelia: desvincular piezas J51 de SGDE…');
  for (const docId of j51DocIds) {
    await admin
      .from('case_documents')
      .update({
        sgde_id: null,
        sgde_sync_status: 'local_only',
        sgde_folder_path: 'Segunda instancia / Impugnación',
        updated_at: new Date().toISOString(),
      })
      .eq('id', docId);
  }

  await admin.from('case_sgde_folder_map').delete().eq('case_id', CASE_ID);

  await admin
    .from('cases')
    .update({
      sgde_id: null,
      sgde_sync_status: 'idle',
      updated_at: new Date().toISOString(),
    })
    .eq('id', CASE_ID);

  console.log('\nListo.');
  console.log(`- Expediente PI compartido (${ORIGIN_SGDE_ROOT.slice(0, 8)}…) se mantiene solo lectura.`);
  console.log('- Piezas Impugnación / informe: Solo Tutelia hasta permiso de edición.');
  console.log(`- Radicado origen: ${RADICADO_ORIGEN}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
