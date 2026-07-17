/**
 * Reintenta sync de documentos SGDE para las 20 tutelas recién importadas.
 * npx tsx scripts/retry-sgde-docs-latest-tutelas.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client.ts';
import { decryptSgdePassword } from '../server/sgde-crypto.ts';
import { repairStorageFromSgde } from '../server/sgde-repair-storage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const m: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const f = path.join(root, name);
    if (!fs.existsSync(f)) continue;
    Object.assign(m, dotenv.parse(fs.readFileSync(f, 'utf8')));
  }
  for (const [k, v] of Object.entries(m)) if (!process.env[k]) process.env[k] = v;
  return m;
}
const env = loadEnv();
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '',
  env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false } },
);

const { data: creds } = await admin
  .from('sgde_credentials')
  .select('user_id, username, password_ciphertext')
  .order('updated_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (!creds) throw new Error('Sin credenciales SGDE');

const password = decryptSgdePassword(String(creds.password_ciphertext));
const client = new SgdeClient(getDefaultSgdeBaseUrl());
await client.login(String(creds.username), password);
console.log('SGDE login OK, ticket=', Boolean(client));

const { data: cases } = await admin
  .from('cases')
  .select('id, radicado, sgde_id')
  .eq('court_id', 'court-1')
  .eq('case_type', 'tutela_primera')
  .eq('source_channel', 'sgde_import')
  .order('radicado', { ascending: false });

console.log('tutelas a sync:', (cases ?? []).length);

let ok = 0;
let fail = 0;
for (const row of cases ?? []) {
  const caseId = String(row.id);
  const radicado = String(row.radicado);
  let sgdeRootId = String(row.sgde_id || '').trim();
  try {
    if (!sgdeRootId) {
      sgdeRootId = (await client.buscarExpedienteNodeId(radicado)) || '';
    }
    if (!sgdeRootId) throw new Error('sin nodo SGDE');
    // Re-login periódico por si el ticket caduca
    const result = await repairStorageFromSgde({
      client,
      admin,
      caseId,
      sgdeRootId,
      caseType: 'tutela_primera',
      originRadicado: radicado,
      importSgdeOnly: true,
    });
    console.log(
      `OK ${radicado} imported=${result.imported} repaired=${result.repaired} skipped=${result.skipped} msg=${result.message}`,
    );
    ok += 1;
  } catch (e) {
    fail += 1;
    console.error(`FAIL ${radicado}:`, e instanceof Error ? e.message : e);
    // refresh session
    try {
      await client.login(String(creds.username), password);
    } catch {
      /* ignore */
    }
  }
}
console.log(JSON.stringify({ ok, fail }, null, 2));
