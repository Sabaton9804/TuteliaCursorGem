/**
 * Genera síntesis cognitiva (cases.summary) con IA para procesos del despacho.
 *
 * Uso:
 *   npm run batch:sintesis-cognitiva -- --solo-activos --solo-civiles
 *   npm run batch:sintesis-cognitiva -- --limit=10 --dry-run
 *   npm run batch:sintesis-cognitiva -- --all --force
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import {
  generateCaseSynthesis,
  type CaseSynthesisInput,
} from '../server/synthesize-case-service.ts';

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

const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const openaiKey = env.OPENAI_API_KEY || '';

const args = process.argv.slice(2);
const courtId = args.find((a) => a.startsWith('--court='))?.split('=')[1] || 'court-1';
const limitArg = args.find((a) => a.startsWith('--limit='));
const delayArg = args.find((a) => a.startsWith('--delay-ms='));
const all = args.includes('--all');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const soloActivos = args.includes('--solo-activos') || args.includes('--activos');
const soloCiviles = !args.includes('--incluir-tutelas');
const skipExisting = !force;

const limit = all ? 10_000 : limitArg ? Math.max(1, parseInt(limitArg.split('=')[1] || '50', 10)) : soloActivos ? 10_000 : 50;
const delayMs = delayArg ? Math.max(0, parseInt(delayArg.split('=')[1] || '800', 10)) : 800;

if (!urlRaw || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!openaiKey && !dryRun) {
  console.error('Falta OPENAI_API_KEY');
  process.exit(1);
}

const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const openai = dryRun ? null : new OpenAI({ apiKey: openaiKey });

type CaseRow = {
  id: string;
  radicado: string;
  case_type: string | null;
  claimant: string | null;
  defendant: string | null;
  subject: string | null;
  status: string | null;
  operational_status: string | null;
  deadline_at: string | null;
  assigned_to: string | null;
  legal_hechos: string | null;
  legal_pretensiones: string | null;
  legal_derecho_tutelado: string | null;
  raw_text: string | null;
  summary: string | null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const fetchCap = all || soloActivos ? 10_000 : limit;
  const { data, error } = await admin
    .from('cases')
    .select(
      'id, radicado, case_type, claimant, defendant, subject, status, operational_status, deadline_at, assigned_to, legal_hechos, legal_pretensiones, legal_derecho_tutelado, raw_text, summary, catalog_metadata',
    )
    .eq('court_id', courtId)
    .order('radicado', { ascending: true })
    .limit(fetchCap);

  if (error) throw error;

  let rows = (data ?? []) as CaseRow[];
  if (soloCiviles) rows = rows.filter(isCivilRow);
  if (soloActivos) rows = rows.filter(isActivoRow);
  if (skipExisting) rows = rows.filter((r) => !String(r.summary ?? '').trim());
  if (!all && rows.length > limit) rows = rows.slice(0, limit);

  console.log(
    JSON.stringify(
      {
        courtId,
        candidates: rows.length,
        soloActivos,
        soloCiviles,
        skipExisting,
        dryRun,
        delayMs,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      },
      null,
      2,
    ),
  );

  if (rows.length === 0) {
    console.log('Nada que sintetizar.');
    return;
  }

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const progress = `[${i + 1}/${rows.length}]`;
    const radicado = String(row.radicado);

    const [{ data: docs }, { data: actions }] = await Promise.all([
      admin
        .from('case_documents')
        .select('name, original_name, type, created_at')
        .eq('case_id', row.id)
        .order('sort_order', { ascending: true }),
      admin
        .from('case_actions')
        .select('description, created_at')
        .eq('case_id', row.id)
        .order('created_at', { ascending: false })
        .limit(12),
    ]);

    const documentTitles = (docs ?? [])
      .map((d) => String(d.original_name || d.name || '').trim())
      .filter(Boolean);
    const actionLines = (actions ?? [])
      .map((a) => String(a.description || '').trim())
      .filter(Boolean);

    const input: CaseSynthesisInput = {
      radicado,
      caseType: row.case_type,
      claimant: String(row.claimant ?? ''),
      defendant: String(row.defendant ?? ''),
      subject: row.subject,
      status: row.status,
      operationalStatus: row.operational_status,
      deadlineAt: row.deadline_at,
      assignedTo: row.assigned_to,
      legalHechos: row.legal_hechos,
      legalPretensiones: row.legal_pretensiones,
      legalDerechoTutelado: row.legal_derecho_tutelado,
      rawText: row.raw_text,
      catalogMetadata: row.catalog_metadata,
      documentTitles,
      actionLines,
    };

    if (dryRun) {
      console.log(`${progress} [dry-run] ${radicado} docs=${documentTitles.length} acciones=${actionLines.length}`);
      ok += 1;
      continue;
    }

    try {
      const summary = await generateCaseSynthesis(openai!, input);
      const now = new Date().toISOString();
      const { error: updErr } = await admin
        .from('cases')
        .update({ summary, updated_at: now })
        .eq('id', row.id);
      if (updErr) throw updErr;

      await admin.from('case_actions').insert({
        case_id: row.id,
        type: 'ai_synthesis',
        description: 'Síntesis cognitiva generada por lote (IA)',
        user_name: 'Sistema (batch)',
      });

      console.log(`${progress} OK ${radicado} (${summary.length} chars)`);
      ok += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${progress} FAIL ${radicado}: ${msg}`);
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
