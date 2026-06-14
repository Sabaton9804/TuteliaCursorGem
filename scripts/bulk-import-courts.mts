/**
 * Importación masiva de despachos desde CSV.
 *
 * Requiere migración 20260614120000_bulk_import_courts.sql aplicada.
 * Usa SUPABASE_SERVICE_ROLE_KEY (RPC bulk_upsert_courts).
 *
 * Uso:
 *   npm run bulk:import-courts -- scripts/samples/courts-import-template.csv
 *   npm run bulk:import-courts -- ruta.csv --dry-run
 *   npm run bulk:import-courts -- ruta.csv --batch 50
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { csvRowsToObjects, parseCsv } from '../src/lib/csv-parse.ts';

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

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}

type ImportRow = Record<string, string>;
type RpcResult = { row_num: number; court_id: string | null; action: string; message: string | null };

const env = loadEnv();
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const batchArg = args.find((a) => a.startsWith('--batch='));
const batchSize = batchArg ? Math.max(1, parseInt(batchArg.split('=')[1] || '100', 10)) : 100;

if (!csvPath) {
  console.error('Uso: npm run bulk:import-courts -- <archivo.csv> [--dry-run] [--batch=100]');
  process.exit(1);
}

if (!urlRaw || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const fullPath = path.resolve(process.cwd(), csvPath);
if (!fs.existsSync(fullPath)) {
  console.error('Archivo no encontrado:', fullPath);
  process.exit(1);
}

const admin = createClient(normalizeUrl(urlRaw), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function toPayload(row: ImportRow): ImportRow {
  const out: ImportRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== '') out[k] = v;
  }
  return out;
}

async function main() {
  const text = fs.readFileSync(fullPath, 'utf8');
  const objects = csvRowsToObjects(parseCsv(text)).map(toPayload);

  if (objects.length === 0) {
    console.error('CSV vacío o sin filas de datos (requiere encabezado + al menos 1 fila).');
    process.exit(1);
  }

  console.log(`Archivo: ${fullPath}`);
  console.log(`Filas:   ${objects.length}${dryRun ? ' (dry-run)' : ''}`);

  if (dryRun) {
    for (let i = 0; i < objects.length; i++) {
      const r = objects[i];
      if (!r.name?.trim()) {
        console.error(`  Fila ${i + 1}: ERROR — name requerido`);
        continue;
      }
      const hasCui =
        (r.cui_12?.replace(/\D/g, '').length ?? 0) === 12 ||
        Boolean(r.dane_code && r.entity_code && r.specialty_code && r.despacho_number);
      console.log(`  Fila ${i + 1}: ${hasCui ? 'OK' : 'ERROR CUI'} — ${r.name}`);
    }
    return;
  }

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (let offset = 0; offset < objects.length; offset += batchSize) {
    const chunk = objects.slice(offset, offset + batchSize);
    const { data, error } = await admin.rpc('bulk_upsert_courts', { p_rows: chunk });
    if (error) {
      if (/bulk_upsert_courts|function.*does not exist/i.test(error.message)) {
        console.error(
          'Falta la migración bulk import. Aplique supabase/migrations/20260614120000_bulk_import_courts.sql'
        );
      }
      throw new Error(error.message);
    }

    const results = (data ?? []) as RpcResult[];
    for (const r of results) {
      const label = `#${r.row_num + offset} ${r.court_id ?? '—'} [${r.action}] ${r.message ?? ''}`;
      if (r.action === 'inserted') {
        inserted++;
        console.log('  +', label);
      } else if (r.action === 'updated') {
        updated++;
        console.log('  ~', label);
      } else {
        errors++;
        console.error('  !', label);
      }
    }
  }

  console.log('\nResumen:', { inserted, updated, errors, total: objects.length });
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error('\n❌', (e as Error).message);
  process.exit(1);
});
