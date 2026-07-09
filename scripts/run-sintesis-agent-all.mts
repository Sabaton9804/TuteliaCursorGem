/**
 * Genera y guarda síntesis cognitiva para todos los civiles activos pendientes (sin OpenAI).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { buildAgentSintesisMarkdown } from './sintesis-agent-builder.ts';

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
const dryRun = process.argv.includes('--dry-run');

const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data, error } = await admin
    .from('cases')
    .select('id, radicado, claimant, defendant, subject, case_type, operational_status, summary, catalog_metadata')
    .eq('court_id', courtId)
    .order('radicado', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []).filter((r) => {
    const meta = (r.catalog_metadata as Record<string, unknown> | null) ?? {};
    const civil = String(r.case_type ?? '').startsWith('civil_') || meta.tipo_registro === 'civil';
    const activo = String(meta.situacion_plataforma ?? '').toLowerCase() === 'activo';
    const sinSintesis = !String(r.summary ?? '').trim();
    return civil && activo && sinSintesis;
  });

  console.log(JSON.stringify({ courtId, pendientes: rows.length, dryRun }, null, 2));

  let ok = 0;
  for (const r of rows) {
    const m = (r.catalog_metadata as Record<string, unknown> | null) ?? {};
    const summary = buildAgentSintesisMarkdown({
      radicado: String(r.radicado),
      demandante: r.claimant ? String(r.claimant) : null,
      demandado: r.defendant ? String(r.defendant) : null,
      tipo_proceso: m.tipo_proceso ? String(m.tipo_proceso) : r.subject ? String(r.subject) : null,
      situacion: m.situacion_plataforma ? String(m.situacion_plataforma) : null,
      etapa: m.etapa ? String(m.etapa) : null,
      ubicacion: m.ubicacion_interna ? String(m.ubicacion_interna) : r.operational_status ? String(r.operational_status) : null,
      tramite: m.tramite_pendiente ? String(m.tramite_pendiente) : null,
      encargado: m.encargado_nombre ? String(m.encargado_nombre) : null,
      ultimo_auto: m.ultimo_auto_tipo
        ? `${m.ultimo_auto_tipo}${m.ultimo_auto_fecha ? ` (${m.ultimo_auto_fecha})` : ''}`
        : null,
    });

    if (dryRun) {
      console.log(`[dry-run] ${r.radicado} (${summary.length} chars)`);
      ok += 1;
      continue;
    }

    const now = new Date().toISOString();
    const { error: updErr } = await admin.from('cases').update({ summary, updated_at: now }).eq('id', r.id);
    if (updErr) throw updErr;
    await admin.from('case_actions').insert({
      case_id: r.id,
      type: 'ai_synthesis',
      description: 'Síntesis cognitiva generada por agente (sin API externa)',
      user_name: 'Agente IA',
    });
    ok += 1;
    if (ok % 25 === 0) console.log(`Progreso: ${ok}/${rows.length}`);
  }

  console.log(JSON.stringify({ ok, total: rows.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
