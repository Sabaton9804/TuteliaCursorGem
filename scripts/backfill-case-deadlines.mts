/**
 * Rellena deadline_at donde falta (Decreto 2591/1991: 10 háb. 1ª instancia, 20 háb. 2ª).
 * Usa la misma lógica que la app (`businessDayTermEnd` + `case_type`).
 *
 * Requiere en .env o .env.local: VITE_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uso: npm run backfill:case-deadlines
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { businessDayTermEnd, startOfLocalDay } from '../src/lib/business-days.ts';
import { caseTermBusinessDaysFromDecreto2591 } from '../src/lib/decreto-2591-plazos.ts';
import type { CaseType } from '../src/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function loadMergedEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(stripBom(fs.readFileSync(full, 'utf8')));
    for (const [key, raw] of Object.entries(parsed)) {
      const t = typeof raw === 'string' ? raw.trim() : String(raw).trim();
      if (t !== '') merged[key] = t;
    }
  }
  return merged;
}

function normalizeSupabaseUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s;
}

const env = loadMergedEnv();
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!urlRaw?.trim() || !serviceKey?.trim()) {
  console.error('Faltan VITE_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(normalizeSupabaseUrl(urlRaw), serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: rows, error } = await supabase
    .from('cases')
    .select('id, created_at, case_type')
    .is('deadline_at', null);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const list = rows ?? [];
  console.log(`Expedientes sin deadline_at: ${list.length}`);

  for (const row of list) {
    const created = row.created_at as string;
    const filing = startOfLocalDay(new Date(created));
    const caseType = (row.case_type as CaseType | null) ?? 'tutela_primera';
    const termDays = caseTermBusinessDaysFromDecreto2591(caseType);
    const deadline = businessDayTermEnd(filing, termDays).toISOString();
    const { error: upErr } = await supabase.from('cases').update({ deadline_at: deadline }).eq('id', row.id);
    if (upErr) {
      console.error('Update falló', row.id, upErr);
      process.exit(1);
    }
    console.log(`OK ${row.id} → ${deadline}`);
  }

  console.log('Listo.');
}

void main();
