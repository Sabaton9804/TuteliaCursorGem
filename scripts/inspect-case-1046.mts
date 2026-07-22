/**
 * Inventario caso 2026-1046 (segunda instancia).
 * Uso: npx tsx scripts/inspect-case-1046.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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

async function main() {
  const env = loadEnv();
  const urlRaw =
    env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(urlRaw.replace(/\/+$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: c } = await admin
    .from('cases')
    .select('id, radicado, origin_radicado, case_type, sgde_id, sgde_sync_status, created_at')
    .eq('id', CASE_ID)
    .maybeSingle();
  console.log('CASE:', c);

  const { data: docs } = await admin
    .from('case_documents')
    .select(
      'id, name, original_name, type, notebook_code, sgde_id, sgde_sync_status, storage_path, sort_order, created_at, is_from_link',
    )
    .eq('case_id', CASE_ID)
    .order('sort_order');
  console.log('\nDOCS (' + (docs?.length ?? 0) + '):');
  for (const d of docs || []) {
    console.log(
      `  [${d.sort_order}] ${d.name} | orig=${d.original_name} | type=${d.type} | sgde=${d.sgde_sync_status} | sgde_id=${d.sgde_id?.slice(0, 8) ?? '-'} | link=${d.is_from_link} | ${d.created_at}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
