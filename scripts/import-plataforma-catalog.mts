/**
 * ETL catalogo.db (plataforma J51) → Supabase cases + case_actions.
 *
 * Requiere migración 20260708120000_procesos_civiles_catalog_metadata.sql.
 * Upsert idempotente por (court_id, radicado).
 *
 * Uso:
 *   npm run import:plataforma-catalog
 *   npm run import:plataforma-catalog -- --dry-run
 *   npm run import:plataforma-catalog -- --db "C:\...\catalogo.db" --court court-1
 *   npm run import:plataforma-catalog -- --solo-civiles
 *   npm run import:plataforma-catalog -- --solo-tutelas
 */
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_DB = path.resolve(
  projectRoot,
  '..',
  '..',
  'PhytonJ51ccto',
  'plataforma',
  'data',
  'catalogo.db',
);

type PlataformaProceso = Record<string, unknown>;
type PlataformaEvento = Record<string, unknown>;

type CatalogMetadata = {
  ubicacion_interna?: string;
  regimen?: string;
  confianza_estado?: string;
  tipo_proceso?: string;
  subserie_sgde?: string;
  fuente_estado?: string;
  etapa?: string;
  tramite_pendiente?: string;
  ultimo_auto_fecha?: string;
  ultimo_auto_tipo?: string;
  situacion_plataforma?: string;
  clase?: string;
  subclase?: string;
  tipo_registro?: 'civil' | 'tutela';
  encargado_nombre?: string;
  instancia?: string;
  anio?: number;
  link_expediente?: string;
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

function normalizeRadicado(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length >= 23) return digits.slice(0, 23);
  return digits.padStart(23, '0').slice(0, 23);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function mapTipoProcesoToCivilCaseType(tipoProceso: string): string {
  const t = tipoProceso.toLowerCase();
  if (t.includes('ejecutiv')) return 'civil_ejecutivo';
  if (t.includes('jurisdicci') && t.includes('voluntaria')) return 'civil_jurisdiccion_voluntaria';
  if (t.includes('insolvencia')) return 'civil_insolvencia';
  if (t.includes('otros proceso')) return 'civil_otros';
  return 'civil_ordinario';
}

function mapInstanciaToTutelaCaseType(instancia: string): string {
  const i = instancia.toLowerCase();
  if (i.includes('segunda') || i.includes('2')) return 'tutela_segunda';
  return 'tutela_primera';
}

function mapSituacion(
  situacion: string,
  ubicacionInterna: string,
  etapa: string,
  tipoTerminacion: string,
): { status: string; operationalStatus: string } {
  const sit = situacion.toLowerCase();
  const ub = ubicacionInterna || etapa || '';
  if (sit === 'remitido') {
    return { status: 'transfer', operationalStatus: ub || 'Remitido' };
  }
  if (sit === 'terminado') {
    const tt = tipoTerminacion.toLowerCase();
    const ubLow = ub.toLowerCase();
    if (tt.includes('archiv') || ubLow.includes('archiv')) {
      return { status: 'archived', operationalStatus: ub || 'Terminado' };
    }
    return { status: 'judgment', operationalStatus: ub || 'Terminado' };
  }
  const ubLow = ub.toLowerCase();
  if (ubLow.includes('admit') || ubLow.includes('tramit') || ubLow.includes('términ') || ubLow.includes('termin')) {
    return { status: 'admitted', operationalStatus: ub || 'Activo' };
  }
  return { status: 'received', operationalStatus: ub || 'Activo' };
}

function mapDecisionType(tipoTerminacion: string): string | null {
  const t = tipoTerminacion.toUpperCase();
  if (t.includes('CONCED')) return 'concedio';
  if (t.includes('NIEG') || t.includes('NEG')) return 'nego';
  return null;
}

function buildCatalogMetadata(p: PlataformaProceso): CatalogMetadata {
  const tipoRegistro = str(p.tipo_registro);
  return {
    ubicacion_interna: str(p.ubicacion_interna) || undefined,
    regimen: str(p.regimen) || undefined,
    confianza_estado: str(p.confianza_estado) || undefined,
    tipo_proceso: str(p.tipo_proceso) || undefined,
    subserie_sgde: str(p.subserie_sgde) || undefined,
    fuente_estado: str(p.fuente_estado) || undefined,
    etapa: str(p.etapa) || undefined,
    tramite_pendiente: str(p.tramite_pendiente) || undefined,
    ultimo_auto_fecha: str(p.ultimo_auto_fecha) || undefined,
    ultimo_auto_tipo: str(p.ultimo_auto_tipo) || undefined,
    situacion_plataforma: str(p.situacion) || undefined,
    clase: str(p.clase) || undefined,
    subclase: str(p.subclase) || undefined,
    tipo_registro: tipoRegistro === 'civil' || tipoRegistro === 'tutela' ? tipoRegistro : undefined,
    encargado_nombre: str(p.encargado) || undefined,
    instancia: str(p.instancia) || undefined,
    anio: typeof p.anio === 'number' ? p.anio : undefined,
    link_expediente: str(p.link_expediente) || undefined,
  };
}

function parseDateIso(d: string): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`;
}

function shouldSkipMergeStatus(
  existingStatus: string | undefined,
  incomingStatus: string,
  confianza: string,
  situacion: string,
): boolean {
  const closed = existingStatus === 'judgment' || existingStatus === 'archived';
  const incomingClosed = incomingStatus === 'judgment' || incomingStatus === 'archived';
  if (closed && !incomingClosed && confianza === 'alta' && situacion === 'terminado') {
    return true;
  }
  if (closed && !incomingClosed) return true;
  return false;
}

const env = loadEnv();
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const soloCiviles = args.includes('--solo-civiles');
const soloTutelas = args.includes('--solo-tutelas');
const dbArg = args.find((a) => a.startsWith('--db='));
const courtArg = args.find((a) => a.startsWith('--court='));
const dbPath = dbArg ? dbArg.split('=')[1] : DEFAULT_DB;
const courtId = courtArg ? courtArg.split('=')[1] : 'court-1';

if (!urlRaw || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error('No se encontró catalogo.db:', dbPath);
  process.exit(1);
}

const admin = createClient(normalizeUrl(urlRaw), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const exportScript = path.join(__dirname, '_export_catalogo_json.py');
const exported = spawnSync('python', [exportScript, dbPath], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});
if (exported.status !== 0) {
  console.error('Error exportando SQLite:', exported.stderr || exported.stdout);
  process.exit(1);
}

const payload = JSON.parse(exported.stdout) as {
  procesos: PlataformaProceso[];
  eventos: PlataformaEvento[];
};

async function loadProcessDefinitionIds(): Promise<Record<string, string>> {
  const { data, error } = await admin.from('process_definitions').select('id, code');
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[String((row as { code: string }).code)] = String((row as { id: string }).id);
  }
  return map;
}

async function loadAssigneeMap(court: string): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, name')
    .eq('court_id', court);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const name = str((row as { name: string }).name);
    if (name) map.set(name.toLowerCase(), String((row as { id: string }).id));
  }
  return map;
}

async function loadExistingCases(court: string): Promise<Map<string, Record<string, unknown>>> {
  const { data, error } = await admin
    .from('cases')
    .select('id, radicado, status, sgde_id, catalog_metadata, case_type')
    .eq('court_id', court);
  if (error) throw error;
  const map = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    map.set(str((row as { radicado: string }).radicado), row as Record<string, unknown>);
  }
  return map;
}

function resolveAssignee(encargado: string, assignees: Map<string, string>): string | null {
  const key = encargado.toLowerCase();
  if (assignees.has(key)) return assignees.get(key)!;
  const first = encargado.split(/\s+/)[0]?.toLowerCase();
  if (first) {
    for (const [name, id] of assignees) {
      if (name.startsWith(first)) return id;
    }
  }
  return null;
}

async function main() {
  let procDefs: Record<string, string> = {};
  let assignees = new Map<string, string>();
  let existing = new Map<string, Record<string, unknown>>();

  if (dryRun) {
    procDefs = {
      civil_ordinario: 'dry-civil_ordinario',
      civil_ejecutivo: 'dry-civil_ejecutivo',
      civil_jurisdiccion_voluntaria: 'dry-civil_jurisdiccion_voluntaria',
      civil_insolvencia: 'dry-civil_insolvencia',
      civil_otros: 'dry-civil_otros',
      tutela_primera: 'dry-tutela_primera',
      tutela_segunda: 'dry-tutela_segunda',
      consulta_desacato: 'dry-consulta_desacato',
    };
  } else {
    procDefs = await loadProcessDefinitionIds();
    assignees = await loadAssigneeMap(courtId);
    existing = await loadExistingCases(courtId);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const caseIdByRadicado = new Map<string, string>();

  for (const p of payload.procesos) {
    const tipoRegistro = str(p.tipo_registro);
    if (soloCiviles && tipoRegistro !== 'civil') continue;
    if (soloTutelas && tipoRegistro !== 'tutela') continue;

    const radicado = normalizeRadicado(p.radicado);
    if (radicado.length < 20) {
      skipped += 1;
      continue;
    }

    const catalogMeta = buildCatalogMetadata(p);
    const { status, operationalStatus } = mapSituacion(
      str(p.situacion),
      str(p.ubicacion_interna),
      str(p.etapa),
      str(p.tipo_terminacion),
    );

    let caseType: string;
    let processDefinitionId: string | null = null;
    if (tipoRegistro === 'civil') {
      caseType = mapTipoProcesoToCivilCaseType(str(p.tipo_proceso) || str(p.clase));
      processDefinitionId = procDefs[caseType] ?? procDefs.civil_ordinario ?? null;
    } else {
      caseType = mapInstanciaToTutelaCaseType(str(p.instancia));
      processDefinitionId = procDefs[caseType] ?? null;
    }

    const prev = existing.get(radicado);
    const mergedCatalog: CatalogMetadata = {
      ...(prev?.catalog_metadata as CatalogMetadata | undefined),
      ...catalogMeta,
    };

    let finalStatus = status;
    if (prev && shouldSkipMergeStatus(str(prev.status), status, str(p.confianza_estado), str(p.situacion))) {
      finalStatus = str(prev.status);
    }

    const assigned = resolveAssignee(str(p.encargado), assignees);
    const fechaIngreso = parseDateIso(str(p.fecha_ingreso) || str(p.fecha_radicacion));
    const fechaVenc = parseDateIso(str(p.fecha_vencimiento));
    const fechaTerm = parseDateIso(str(p.fecha_terminacion));
    const decisionType = mapDecisionType(str(p.tipo_terminacion));

    const row: Record<string, unknown> = {
      court_id: courtId,
      radicado,
      claimant: str(p.demandante),
      defendant: str(p.demandado),
      claimant_id: str(p.demandante_id) || null,
      defendant_id: str(p.demandado_id) || null,
      status: finalStatus,
      operational_status: operationalStatus,
      case_type: caseType,
      process_definition_id: processDefinitionId,
      subject: str(p.tipo_proceso) || str(p.clase) || null,
      legal_derecho_tutelado: tipoRegistro === 'tutela' ? str(p.clase) || null : null,
      catalog_metadata: mergedCatalog,
      source_channel: 'plataforma_catalog',
      assigned_to: assigned,
      sgde_id: str(p.sgde_expediente_id) || (prev ? str(prev.sgde_id) : null) || null,
      sgde_sync_status: str(p.sgde_expediente_id) ? 'linked' : prev ? prev.sgde_sync_status : 'idle',
      sgde_linked_at: str(p.sgde_expediente_id) ? new Date().toISOString() : null,
      deadline_at: tipoRegistro === 'tutela' ? fechaVenc : null,
      decision_at: fechaTerm,
      decision_type: decisionType,
      updated_at: new Date().toISOString(),
    };

    if (!prev && fechaIngreso) {
      row.created_at = fechaIngreso;
    }

    if (dryRun) {
      console.log(`[dry-run] ${tipoRegistro} ${radicado} → ${caseType} (${finalStatus})`);
      caseIdByRadicado.set(radicado, prev ? String(prev.id) : `dry-${radicado}`);
      if (prev) updated += 1;
      else inserted += 1;
      continue;
    }

    const { data, error } = await admin
      .from('cases')
      .upsert(row, { onConflict: 'court_id,radicado' })
      .select('id')
      .single();

    if (error) {
      console.error(`Error upsert ${radicado}:`, error.message);
      skipped += 1;
      continue;
    }

    const caseId = String((data as { id: string }).id);
    caseIdByRadicado.set(radicado, caseId);
    if (prev) updated += 1;
    else inserted += 1;
  }

  let eventsInserted = 0;
  let eventsSkipped = 0;

  for (const ev of payload.eventos) {
    const radicado = normalizeRadicado(ev.radicado);
    const caseId = caseIdByRadicado.get(radicado);
    if (!caseId || caseId.startsWith('dry-')) {
      eventsSkipped += 1;
      continue;
    }

    const fecha = str(ev.fecha_auto);
    const tipo = str(ev.tipo_auto);
    const fuente = str(ev.fuente) || 'plataforma';
    const description = str(ev.resumen_auto) || str(ev.tipo_auto) || 'Evento catálogo';

    if (dryRun) {
      eventsInserted += 1;
      continue;
    }

    const { data: dup } = await admin
      .from('case_actions')
      .select('id')
      .eq('case_id', caseId)
      .eq('type', 'catalog_event')
      .contains('metadata', { fecha_auto: fecha, tipo_auto: tipo, fuente })
      .maybeSingle();

    if (dup?.id) {
      eventsSkipped += 1;
      continue;
    }

    const { error } = await admin.from('case_actions').insert({
      case_id: caseId,
      type: 'catalog_event',
      description: description.slice(0, 2000),
      user_name: 'Importación plataforma',
      metadata: {
        fecha_auto: fecha,
        tipo_auto: tipo,
        fuente,
        clasificacion_sierju: str(ev.clasificacion_sierju) || null,
        subtipo_sierju: str(ev.subtipo_sierju) || null,
        archivo_estado: str(ev.archivo_estado) || null,
        es_tutela: ev.es_tutela === 1,
      },
    });

    if (error) {
      eventsSkipped += 1;
    } else {
      eventsInserted += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        courtId,
        dryRun,
        procesos: { inserted, updated, skipped, total: payload.procesos.length },
        eventos: { inserted: eventsInserted, skipped: eventsSkipped, total: payload.eventos.length },
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
