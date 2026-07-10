/**
 * Importa enlaces Planner (SharePoint/OneDrive + SGDE) y metadatos operativos.
 * Por defecto solo tareas activas (En curso / No iniciado; excluye Completado).
 *
 * Uso:
 *   npm run import:planner-links -- --xlsx "C:\...\Procesos Juzgado 51 Ccto.xlsx"
 *   npm run import:planner-links -- --dry-run
 *   npm run import:planner-links -- --incluir-completadas
 */
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import type { CaseCatalogMetadata } from '../src/lib/case-catalog-metadata.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_XLSX = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'Procesos Juzgado 51 Ccto.xlsx',
);

type PlannerRow = {
  radicado: string;
  task_name: string;
  link_expediente: string | null;
  sgde_url: string | null;
  sgde_id: string | null;
  deposito: string;
  estado_planner: string;
  etiquetas: string;
  fecha_vencimiento: string;
  notas_preview: string;
};

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

function normalizeRadicado(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length >= 23) return digits.slice(0, 23);
  if (digits.length >= 21) return digits.padStart(23, '0').slice(0, 23);
  return '';
}

function mapPlannerDeposito(deposito: string): string | undefined {
  const d = deposito.trim();
  return d || undefined;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const urlRaw = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const incluirCompletadas = args.includes('--incluir-completadas') || args.includes('--todas');
  const xlsxArg = args.find((a) => a.startsWith('--xlsx='));
  const courtArg = args.find((a) => a.startsWith('--court='));
  const xlsxPath = xlsxArg ? xlsxArg.split('=').slice(1).join('=') : DEFAULT_XLSX;
  const courtId = courtArg ? courtArg.split('=')[1] : 'court-1';

  if (!urlRaw || !serviceKey) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!fs.existsSync(xlsxPath)) {
    console.error('No se encontró el Excel:', xlsxPath);
    process.exit(1);
  }

  const exportPy = path.join(__dirname, '_export_planner_json.py');
  const tmpJson = path.join(__dirname, '_planner_import_tmp.json');
  const pyArgs = [exportPy, xlsxPath, 'Datos consolidados', tmpJson];
  if (!incluirCompletadas) pyArgs.push('--solo-activas');
  const exported = spawnSync('python', pyArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (exported.status !== 0) {
    console.error('Error leyendo Planner:', exported.stderr || exported.stdout);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(tmpJson, 'utf8')) as {
    stats: Record<string, number>;
    rows: PlannerRow[];
  };
  try {
    fs.unlinkSync(tmpJson);
  } catch {
    /* ignore */
  }

  console.log(
    incluirCompletadas
      ? 'Filtro: todas las tareas Planner'
      : 'Filtro: solo activas (En curso / No iniciado)',
  );
  console.log('Planner export:', payload.stats);

  const admin = createClient(normalizeUrl(urlRaw), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: cases, error } = await admin
    .from('cases')
    .select('id, radicado, catalog_metadata, sgde_id, sgde_sync_status, operational_status')
    .eq('court_id', courtId);
  if (error) throw error;

  const byRadicado = new Map<string, Record<string, unknown>>();
  for (const row of cases ?? []) {
    const rad = normalizeRadicado(String((row as { radicado: string }).radicado));
    if (rad) byRadicado.set(rad, row as Record<string, unknown>);
  }

  let matched = 0;
  let updated = 0;
  let skipped = 0;
  let unmatched = 0;
  let sgdeLinked = 0;
  let shareLinked = 0;

  for (const row of payload.rows) {
    const rad = normalizeRadicado(row.radicado);
    if (!rad) {
      skipped += 1;
      continue;
    }
    const prev = byRadicado.get(rad);
    if (!prev) {
      unmatched += 1;
      continue;
    }
    matched += 1;

    const prevMeta = ((prev.catalog_metadata as CaseCatalogMetadata | null) ?? {}) as CaseCatalogMetadata;
    const metaPatch: CaseCatalogMetadata = { ...prevMeta };
    let metaChanged = false;

    if (row.link_expediente && row.link_expediente !== prevMeta.link_expediente) {
      metaPatch.link_expediente = row.link_expediente;
      metaPatch.link_expediente_fuente = 'planner';
      metaChanged = true;
      shareLinked += 1;
    }
    const dep = mapPlannerDeposito(row.deposito);
    if (dep && dep !== prevMeta.planner_deposito) {
      metaPatch.planner_deposito = dep;
      if (!prevMeta.ubicacion_interna) metaPatch.ubicacion_interna = dep;
      metaChanged = true;
    }
    if (row.estado_planner && row.estado_planner !== prevMeta.planner_estado) {
      metaPatch.planner_estado = row.estado_planner;
      metaChanged = true;
    }
    if (row.etiquetas && row.etiquetas !== prevMeta.planner_etiquetas) {
      metaPatch.planner_etiquetas = row.etiquetas;
      metaChanged = true;
    }
    if (row.fecha_vencimiento && row.fecha_vencimiento !== prevMeta.planner_fecha_vencimiento) {
      metaPatch.planner_fecha_vencimiento = row.fecha_vencimiento;
      metaChanged = true;
    }
    metaPatch.planner_importado_at = new Date().toISOString().slice(0, 10);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (metaChanged) patch.catalog_metadata = metaPatch;

    if (row.sgde_id && !String(prev.sgde_id ?? '').trim()) {
      patch.sgde_id = row.sgde_id;
      patch.sgde_sync_status = 'linked';
      patch.sgde_linked_at = new Date().toISOString();
      sgdeLinked += 1;
    } else if (row.sgde_id && String(prev.sgde_id) !== row.sgde_id) {
      metaPatch.sgde_url_planner = row.sgde_url ?? undefined;
      patch.catalog_metadata = metaPatch;
    }

    if (dep && !String(prev.operational_status ?? '').trim()) {
      patch.operational_status = dep;
    }

    if (Object.keys(patch).length <= 1 && !metaChanged) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      const fields = Object.keys(patch).filter((k) => k !== 'updated_at');
      console.log(`[dry-run] ${rad} → ${fields.join(', ')}`);
      updated += 1;
      continue;
    }

    const { error: upErr } = await admin.from('cases').update(patch).eq('id', String(prev.id));
    if (upErr) {
      console.error(`Error ${rad}:`, upErr.message);
      skipped += 1;
    } else {
      updated += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        courtId,
        dryRun,
        soloActivas: !incluirCompletadas,
        plannerRows: payload.rows.length,
        matched,
        updated,
        skipped,
        unmatched,
        sharepointLinksApplied: shareLinked,
        sgdeIdsApplied: sgdeLinked,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
