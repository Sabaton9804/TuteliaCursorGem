/**
 * Inventario rápido: tutelas vs civiles en cases.
 * npx tsx scripts/inventory-cases-sgde.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    Object.assign(merged, dotenv.parse(fs.readFileSync(full, 'utf8')));
  }
  return merged;
}
const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) {
  console.error('Falta SUPABASE URL o SERVICE_ROLE_KEY');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const { data, error, count } = await admin
  .from('cases')
  .select(
    'id, radicado, case_type, status, sgde_id, source_channel, catalog_metadata, created_at, decision_type, court_id',
    { count: 'exact' },
  )
  .order('created_at', { ascending: false })
  .limit(8000);

if (error) {
  console.error(error);
  process.exit(1);
}

const rows = data ?? [];
const isCivil = (r: (typeof rows)[0]) =>
  String(r.case_type ?? '').startsWith('civil_') ||
  (r.catalog_metadata as Record<string, unknown> | null)?.tipo_registro === 'civil';

const tutelaTypes = new Set(['tutela_primera', 'tutela_segunda', 'consulta_desacato']);
const tutelas = rows.filter(
  (r) =>
    tutelaTypes.has(String(r.case_type ?? '')) ||
    (r.catalog_metadata as Record<string, unknown> | null)?.tipo_registro === 'tutela',
);
const civiles = rows.filter(isCivil);
const other = rows.filter((r) => !tutelas.includes(r) && !civiles.includes(r));

const byType: Record<string, number> = {};
for (const r of rows) {
  const k = String(r.case_type || 'null');
  byType[k] = (byType[k] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      fetched: rows.length,
      countExact: count,
      tutelas: tutelas.length,
      tutelasConSgdeId: tutelas.filter((r) => r.sgde_id).length,
      civiles: civiles.length,
      other: other.length,
      byType,
      courts: [...new Set(rows.map((r) => r.court_id))],
      tutelaRecent: tutelas.slice(0, 8).map((r) => ({
        id: r.id,
        radicado: r.radicado,
        type: r.case_type,
        sgde: Boolean(r.sgde_id),
        status: r.status,
        created: r.created_at,
        decision: r.decision_type,
        source: r.source_channel,
      })),
    },
    null,
    2,
  ),
);
