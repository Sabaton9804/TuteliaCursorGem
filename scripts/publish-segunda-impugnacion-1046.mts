/**
 * Caso 2026-1046: publica impugnación en el expediente SGDE de **origen** (PI).
 * Requiere permiso de escritura sobre el expediente compartido.
 * Uso: npx tsx scripts/publish-segunda-impugnacion-1046.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client.ts';
import { decryptSgdePassword } from '../server/sgde-crypto.ts';
import { publishSegundaTrasladoToSgdeImpugnacion } from '../server/sgde-segunda-impugnacion.ts';

const CASE_ID = '9c64cc8b-9b67-42f0-9356-9cf62b1ef9c0';

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
  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caseRow } = await admin
    .from('cases')
    .select('origin_radicado, sgde_id')
    .eq('id', CASE_ID)
    .single();

  const originRadicado23 = String(caseRow?.origin_radicado || '').replace(/\D/g, '').slice(0, 23);
  const sgdeRootId = String(caseRow?.sgde_id || '').trim();
  const client = await sgdeClientFromDb(admin);

  const pub = await publishSegundaTrasladoToSgdeImpugnacion({
    client,
    admin,
    caseId: CASE_ID,
    sgdeRootId,
    originRadicado23,
  });
  console.log(JSON.stringify(pub, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
