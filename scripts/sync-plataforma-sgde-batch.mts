/**
 * Sincronización SGDE en lote para casos importados desde plataforma (con sgde_id).
 * Por defecto usa credenciales SGDE de la BD + repair-storage directo (service role).
 *
 * Uso:
 *   npm run sync:plataforma-sgde-batch
 *   npm run sync:plataforma-sgde-batch -- --solo-activos --all
 *   npm run sync:plataforma-sgde-batch -- --limit=20 --court=court-1
 *   npm run sync:plataforma-sgde-batch -- --dry-run --solo-activos --all
 *   npm run sync:plataforma-sgde-batch -- --via-api   # requiere sesión HTTP (no recomendado en lote)
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';
import { repairStorageFromSgde } from '../server/sgde-repair-storage';

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

type CaseRow = {
  id: string;
  radicado: string;
  sgde_id: string | null;
  sgde_sync_status: string | null;
  case_type: string | null;
  status: string | null;
  catalog_metadata: Record<string, unknown> | null;
};

function isCivilRow(row: CaseRow): boolean {
  const ct = String(row.case_type ?? '');
  if (ct.startsWith('civil_')) return true;
  return row.catalog_metadata?.tipo_registro === 'civil';
}

function isActivoRow(row: CaseRow): boolean {
  const sit = String(row.catalog_metadata?.situacion_plataforma ?? '').trim().toLowerCase();
  if (sit === 'activo') return true;
  if (sit === 'terminado' || sit === 'remitido') return false;
  const st = String(row.status ?? '');
  return st !== 'archived' && st !== 'judgment';
}

const env = loadEnv();
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const apiBase = (
  env.TUTELIA_API_URL ||
  env.VITE_API_URL ||
  env.APP_URL ||
  `http://localhost:${env.PORT || process.env.PORT || '3451'}`
).replace(/\/+$/, '');

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const courtArg = args.find((a) => a.startsWith('--court='));
const delayArg = args.find((a) => a.startsWith('--delay-ms='));
const all = args.includes('--all');
const dryRun = args.includes('--dry-run');
const viaApi = args.includes('--via-api');
const soloActivos = args.includes('--solo-activos') || args.includes('--activos');
const soloCiviles = !args.includes('--incluir-tutelas');

const limit = all
  ? 10_000
  : limitArg
    ? Math.max(1, parseInt(limitArg.split('=')[1] || '50', 10))
    : soloActivos
      ? 10_000
      : 50;
const courtId = courtArg ? courtArg.split('=')[1] : 'court-1';
const delayMs = delayArg ? Math.max(0, parseInt(delayArg.split('=')[1] || '400', 10)) : 400;

if (!urlRaw || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loadSgdeCreds(client: SupabaseClient): Promise<{ username: string; password: string }> {
  const { data, error } = await client
    .from('sgde_credentials')
    .select('username, password_ciphertext')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.username || !data?.password_ciphertext) {
    throw new Error('Sin credenciales SGDE en sgde_credentials. Configúrelas en Ajustes.');
  }
  return {
    username: String(data.username).trim(),
    password: decryptSgdePassword(String(data.password_ciphertext)),
  };
}

async function fetchCandidates(): Promise<CaseRow[]> {
  const { data, error } = await admin
    .from('cases')
    .select('id, radicado, sgde_id, sgde_sync_status, case_type, status, catalog_metadata')
    .eq('court_id', courtId)
    .not('sgde_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  let rows = (data ?? []) as CaseRow[];

  if (soloCiviles) rows = rows.filter(isCivilRow);
  if (soloActivos) rows = rows.filter(isActivoRow);

  return rows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncOneDirect(
  client: SgdeClient,
  row: CaseRow,
): Promise<{ ok: boolean; message: string }> {
  const caseId = String(row.id);
  const radicado23 = String(row.radicado || '').replace(/\D/g, '').slice(0, 23);
  if (radicado23.length !== 23) {
    return { ok: false, message: 'Radicado inválido' };
  }

  let sgdeRootId = String(row.sgde_id || '').trim();
  if (!sgdeRootId) {
    sgdeRootId = (await client.buscarExpedienteNodeId(radicado23)) || '';
  }
  if (!sgdeRootId) {
    return { ok: false, message: 'Sin nodo SGDE' };
  }

  const result = await repairStorageFromSgde({
    client,
    admin,
    caseId,
    sgdeRootId,
    caseType: row.case_type ? String(row.case_type) : null,
    originRadicado: radicado23,
    importSgdeOnly: true,
  });

  const now = new Date().toISOString();
  await admin
    .from('cases')
    .update({
      sgde_id: sgdeRootId,
      sgde_linked_at: now,
      sgde_sync_status: result.ok ? 'linked' : 'error',
      updated_at: now,
    })
    .eq('id', caseId);

  return { ok: result.ok, message: result.message };
}

async function syncOneApi(row: CaseRow): Promise<{ ok: boolean; message: string }> {
  const caseId = String(row.id);
  const res = await fetch(`${apiBase}/api/sgde/repair-storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId }),
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) return { ok: false, message: body.error || `HTTP ${res.status}` };
  return { ok: true, message: body.message || 'synced' };
}

async function main() {
  const rows = await fetchCandidates();
  console.log(
    JSON.stringify(
      {
        courtId,
        mode: viaApi ? 'http-api' : 'direct-sgde',
        soloActivos,
        soloCiviles,
        limit,
        delayMs,
        dryRun,
        candidates: rows.length,
      },
      null,
      2,
    ),
  );

  if (rows.length === 0) {
    console.log('Nada que sincronizar.');
    return;
  }

  let client: SgdeClient | null = null;
  if (!viaApi && !dryRun) {
    const creds = await loadSgdeCreds(admin);
    client = new SgdeClient(getDefaultSgdeBaseUrl());
    client.setCredentials(creds.username, creds.password);
    const login = await client.login();
    if (!login.ok) throw new Error(`Login SGDE falló: ${login.message}`);
    console.log(`SGDE login OK (${creds.username})`);
  }

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const radicado = String(row.radicado);
    const progress = `[${i + 1}/${rows.length}]`;

    if (dryRun) {
      console.log(`${progress} [dry-run] ${radicado} caseId=${row.id}`);
      ok += 1;
      continue;
    }

    try {
      const result = viaApi
        ? await syncOneApi(row)
        : await syncOneDirect(client!, row);
      if (result.ok) {
        console.log(`${progress} OK ${radicado}: ${result.message}`);
        ok += 1;
      } else {
        console.error(`${progress} FAIL ${radicado}: ${result.message}`);
        fail += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${progress} FAIL ${radicado}:`, msg);
      fail += 1;
    }

    if (delayMs > 0 && i < rows.length - 1) await sleep(delayMs);
  }

  console.log(JSON.stringify({ ok, fail, total: rows.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
