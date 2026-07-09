/**
 * Exporta casos sin síntesis y aplica síntesis desde JSON (generadas por el agente).
 * Uso:
 *   npm run sintesis:export-pendientes
 *   npm run sintesis:apply -- reports/sintesis-agent-batch.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const courtId = process.argv.find((a) => a.startsWith('--court='))?.split('=')[1] || 'court-1';
const mode = process.argv[2] || 'export';

const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Row = {
  id: string;
  radicado: string;
  claimant: string | null;
  defendant: string | null;
  subject: string | null;
  case_type: string | null;
  status: string | null;
  operational_status: string | null;
  summary: string | null;
  catalog_metadata: Record<string, unknown> | null;
};

function isCivil(r: Row) {
  return String(r.case_type ?? '').startsWith('civil_') || r.catalog_metadata?.tipo_registro === 'civil';
}
function isActivo(r: Row) {
  const sit = String(r.catalog_metadata?.situacion_plataforma ?? '').toLowerCase();
  return sit === 'activo';
}

async function fetchPending(): Promise<Row[]> {
  const { data, error } = await admin
    .from('cases')
    .select('id, radicado, claimant, defendant, subject, case_type, status, operational_status, summary, catalog_metadata')
    .eq('court_id', courtId)
    .order('radicado', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Row[]).filter(isCivil).filter(isActivo).filter((r) => !String(r.summary ?? '').trim());
}

async function exportPending() {
  const rows = await fetchPending();
  const out = rows.map((r) => {
    const m = r.catalog_metadata ?? {};
    return {
      id: r.id,
      radicado: r.radicado,
      demandante: r.claimant,
      demandado: r.defendant,
      tipo_proceso: m.tipo_proceso ?? r.subject,
      situacion: m.situacion_plataforma,
      etapa: m.etapa,
      ubicacion: m.ubicacion_interna ?? r.operational_status,
      tramite: m.tramite_pendiente,
      encargado: m.encargado_nombre,
      ultimo_auto: m.ultimo_auto_tipo
        ? `${m.ultimo_auto_tipo}${m.ultimo_auto_fecha ? ` (${m.ultimo_auto_fecha})` : ''}`
        : null,
    };
  });
  const outPath = path.join(projectRoot, 'reports', 'sintesis-pendientes.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ total: out.length, path: outPath }, null, 2));
}

async function applyBatch(filePath: string) {
  const full = path.resolve(projectRoot, filePath);
  const items = JSON.parse(fs.readFileSync(full, 'utf8')) as Array<{ id: string; radicado: string; summary: string }>;
  let ok = 0;
  for (const item of items) {
    const now = new Date().toISOString();
    const { error } = await admin.from('cases').update({ summary: item.summary, updated_at: now }).eq('id', item.id);
    if (error) throw error;
    await admin.from('case_actions').insert({
      case_id: item.id,
      type: 'ai_synthesis',
      description: 'Síntesis cognitiva (agente Cursor)',
      user_name: 'Agente IA',
    });
    ok += 1;
    console.log(`OK ${item.radicado}`);
  }
  console.log(JSON.stringify({ ok, total: items.length }, null, 2));
}

async function main() {
  if (!urlRaw || !serviceKey) {
    console.error('Faltan credenciales Supabase');
    process.exit(1);
  }
  if (mode === 'export') await exportPending();
  else if (mode === 'apply') {
    const file = process.argv[3];
    if (!file) {
      console.error('Uso: npm run sintesis:apply -- reports/sintesis-agent-batch.json');
      process.exit(1);
    }
    await applyBatch(file);
  } else {
    console.error('Modo desconocido');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
