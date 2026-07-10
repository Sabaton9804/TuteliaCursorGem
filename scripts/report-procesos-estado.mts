/**
 * Informe proceso por proceso: situación, trámite/ubicación, etapa, terminación.
 *
 * Uso:
 *   npm run report:procesos-estado
 *   npm run report:procesos-estado -- --court court-1 --csv reports/procesos-estado.csv
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

function csvCell(v: string): string {
  const s = v.replace(/"/g, '""');
  return `"${s}"`;
}

type Row = {
  radicado: string;
  demandante: string;
  demandado: string;
  case_type: string;
  situacion: string;
  ubicacion_interna: string;
  etapa: string;
  tramite_pendiente: string;
  encargado: string;
  tipo_proceso: string;
  ultimo_auto: string;
  status: string;
  terminado: string;
};

function isCivilCatalogRow(raw: {
  case_type?: string | null;
  catalog_metadata?: Record<string, unknown> | null;
}): boolean {
  const ct = String(raw.case_type ?? '');
  if (ct.startsWith('civil_')) return true;
  return (raw.catalog_metadata as Record<string, unknown> | null)?.tipo_registro === 'civil';
}

const env = loadEnv();
const url = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
const courtId = process.argv.find((a) => a.startsWith('--court='))?.split('=')[1] || 'court-1';
const csvArg = process.argv.find((a) => a.startsWith('--csv='))?.split('=')[1];

if (!url || !key) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data, error } = await admin
    .from('cases')
    .select(
      'radicado,case_type,status,operational_status,assigned_to,claimant,defendant,catalog_metadata,subject'
    )
    .eq('court_id', courtId)
    .order('radicado', { ascending: true });

  if (error) throw error;

  const civilData = (data ?? []).filter(isCivilCatalogRow);

  const rows: Row[] = civilData.map((raw) => {
    const m = (raw.catalog_metadata as Record<string, unknown> | null) ?? {};
    const situacion = String(m.situacion_plataforma ?? '').trim();
    const ubicacion = String(m.ubicacion_interna ?? raw.operational_status ?? '').trim();
    const etapa = String(m.etapa ?? '').trim();
    const tramite = String(m.tramite_pendiente ?? '').trim();
    const encargado = String(m.encargado_nombre ?? raw.assigned_to ?? '').trim();
    const tipoProceso = String(m.tipo_proceso ?? raw.subject ?? '').trim();
    const ultimoAuto = m.ultimo_auto_tipo
      ? `${m.ultimo_auto_tipo}${m.ultimo_auto_fecha ? ` (${m.ultimo_auto_fecha})` : ''}`
      : '';
    const terminado = situacion === 'terminado' || raw.status === 'archived' || raw.status === 'judgment' ? 'si' : 'no';

    return {
      radicado: String(raw.radicado ?? ''),
      demandante: String(raw.claimant ?? '').trim(),
      demandado: String(raw.defendant ?? '').trim(),
      case_type: String(raw.case_type ?? ''),
      situacion: situacion || 'sin_dato',
      ubicacion_interna: ubicacion || 'sin_dato',
      etapa: etapa || 'sin_dato',
      tramite_pendiente: tramite || 'sin_dato',
      encargado,
      tipo_proceso: tipoProceso,
      ultimo_auto: ultimoAuto,
      status: String(raw.status ?? ''),
      terminado,
    };
  });

  const bySituacion: Record<string, number> = {};
  const byUbicacion: Record<string, number> = {};
  for (const r of rows) {
    bySituacion[r.situacion] = (bySituacion[r.situacion] ?? 0) + 1;
    byUbicacion[r.ubicacion_interna] = (byUbicacion[r.ubicacion_interna] ?? 0) + 1;
  }

  const topUbic = Object.entries(byUbicacion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log(
    JSON.stringify(
      {
        courtId,
        total: rows.length,
        scope: 'solo_civiles',
        terminados: rows.filter((r) => r.terminado === 'si').length,
        activos: rows.filter((r) => r.situacion === 'activo').length,
        por_situacion: bySituacion,
        top_ubicaciones: topUbic,
      },
      null,
      2
    )
  );

  const header = [
    'radicado',
    'demandante',
    'demandado',
    'tipo_proceso',
    'case_type',
    'situacion',
    'terminado',
    'ubicacion_interna',
    'etapa',
    'tramite_pendiente',
    'encargado',
    'ultimo_auto',
    'status',
  ];

  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.radicado,
        r.demandante,
        r.demandado,
        r.tipo_proceso,
        r.case_type,
        r.situacion,
        r.terminado,
        r.ubicacion_interna,
        r.etapa,
        r.tramite_pendiente,
        r.encargado,
        r.ultimo_auto,
        r.status,
      ]
        .map((v) => csvCell(v))
        .join(',')
    ),
  ];

  const outPath = csvArg
    ? path.resolve(projectRoot, csvArg)
    : path.resolve(projectRoot, 'reports', `procesos-estado-${courtId}.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log('CSV:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
