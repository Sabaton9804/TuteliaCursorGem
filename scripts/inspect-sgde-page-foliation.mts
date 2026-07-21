/**
 * Inspecciona foliación (inicio/fin) en Principal de varios expedientes SGDE.
 * Uso: npx tsx scripts/inspect-sgde-page-foliation.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';

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

async function dumpPrincipal(client: SgdeClient, label: string, expId: string) {
  const folders = await client.ensurePrimeraInstanciaPrincipal(expId);
  if (!folders.ok) {
    console.log(`\n=== ${label} === FAIL ${folders.error}`);
    return;
  }
  // access private via any for inspection
  const children = await (client as unknown as { fetchChildren: (id: string) => Promise<Record<string, unknown>[]> }).fetchChildren(
    folders.principalFolderId,
  );
  const rows: Array<{ name: string; orden: number; paginas: number; ini: number; fin: number }> = [];
  for (const ch of children) {
    const nodeType = String(ch.nodeType || '');
    const isFolder = Boolean(ch.isFolder) || nodeType.includes('folder');
    if (isFolder) continue;
    const p = (ch.properties as Record<string, unknown> | undefined) || {};
    rows.push({
      name: String(ch.name || ''),
      orden: Number(p['rama:idDocumento'] ?? 0) || 0,
      paginas: Number(p['rama:paginas'] ?? 0) || 0,
      ini: Number(p['rama:paginaInicioDoc'] ?? 0) || 0,
      fin: Number(p['rama:paginaFinDoc'] ?? 0) || 0,
    });
  }
  rows.sort((a, b) => a.orden - b.orden);
  console.log(`\n=== ${label} (${rows.length} docs) ===`);
  let expectedIni = 1;
  let cumulativeOk = true;
  for (const r of rows) {
    const expectFin = expectedIni + Math.max(r.paginas, 1) - 1;
    const ok = r.ini === expectedIni && r.fin === expectFin;
    if (!ok && r.paginas > 0) cumulativeOk = false;
    console.log(
      `  #${r.orden} ${r.name}: paginas=${r.paginas} ini=${r.ini} fin=${r.fin}` +
        (r.paginas > 0 ? ` | esperado ini=${expectedIni} fin=${expectFin}${ok ? ' OK' : ' MISMATCH'}` : ''),
    );
    if (r.paginas > 0) expectedIni = expectFin + 1;
  }
  console.log(cumulativeOk ? '  → foliación CORRELATIVA' : '  → foliación NO correlativa (o datos incompletos)');
}

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

  const { data: cases, error: casesErr } = await admin
    .from('cases')
    .select('id, radicado, sgde_id')
    .not('sgde_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (casesErr) throw casesErr;

  const client = new SgdeClient(getDefaultSgdeBaseUrl());
  client.setCredentials(
    String(credRow.username).trim(),
    decryptSgdePassword(String(credRow.password_ciphertext)),
  );
  const login = await client.login();
  if (login.ok === false) throw new Error(`Login SGDE: ${login.message}`);

  for (const c of cases || []) {
    await dumpPrincipal(client, String(c.radicado || c.id), String(c.sgde_id));
  }
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
