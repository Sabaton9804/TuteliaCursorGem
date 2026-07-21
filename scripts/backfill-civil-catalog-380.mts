/**
 * Rellena catalog_metadata del civil 380 (radicado en Tutelia sin metadatos de lista).
 * Uso: npx tsx scripts/backfill-civil-catalog-380.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { buildInitialCivilCatalogMetadata } from '../src/lib/case-catalog-metadata';

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

async function main() {
  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan credenciales Supabase');

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error } = await admin
    .from('cases')
    .select('id, radicado, case_type, subject, assigned_to, legal_derecho_tutelado, catalog_metadata')
    .eq('id', CASE_ID)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error('Caso 380 no encontrado');

  const meta = buildInitialCivilCatalogMetadata({
    caseType: (row.case_type as 'civil_ordinario') || 'civil_ordinario',
    stageCode: 'RADICACION',
    tipoProceso:
      String(row.legal_derecho_tutelado || '').trim() ||
      String(row.subject || '').trim() ||
      null,
    encargadoNombre: row.assigned_to ? String(row.assigned_to) : null,
    anio: 2026,
  });

  const { error: upErr } = await admin
    .from('cases')
    .update({
      catalog_metadata: meta,
      operational_status: 'Para ingresar al despacho',
    })
    .eq('id', CASE_ID);
  if (upErr) throw upErr;

  console.log('OK', row.radicado, meta);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
