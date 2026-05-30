import { supabase } from './supabase';
import type { CaseType } from '../types';
import type { ProcessDefinitionRow, ProcessStageDefinitionRow } from './process-definition-types';
import {
  STAGE_PIPELINE_BY_CASE_TYPE,
  STAGE_LABEL_ES,
  type CaseStageCode,
} from './case-workflow-stages';
import { filterToMvpProductScope, isMvpRadicableCaseType } from './process-product-scope';

export type LoadedProcessDefinition = ProcessDefinitionRow & {
  stages: ProcessStageDefinitionRow[];
  pipeline: readonly CaseStageCode[];
};

let cachedCourtId: string | null = null;
let cachedByLegacyCaseType: Partial<Record<CaseType, LoadedProcessDefinition>> = {};
let cachedByCode: Record<string, LoadedProcessDefinition> = {};

export function setProcessDefinitionsCache(
  courtId: string,
  defs: LoadedProcessDefinition[],
): void {
  cachedCourtId = courtId;
  cachedByLegacyCaseType = {};
  cachedByCode = {};
  for (const d of defs) {
    cachedByCode[d.code] = d;
    if (d.legacy_case_type) {
      cachedByLegacyCaseType[d.legacy_case_type as CaseType] = d;
    }
  }
}

export function getCachedProcessDefinitionByCaseType(
  caseType: CaseType | undefined,
): LoadedProcessDefinition | null {
  const t = caseType ?? 'tutela_primera';
  return cachedByLegacyCaseType[t] ?? null;
}

export function getCachedPipelineForCaseType(caseType: CaseType | undefined): readonly CaseStageCode[] {
  const loaded = getCachedProcessDefinitionByCaseType(caseType);
  if (loaded?.pipeline.length) return loaded.pipeline;
  const t = caseType ?? 'tutela_primera';
  return STAGE_PIPELINE_BY_CASE_TYPE[t] ?? STAGE_PIPELINE_BY_CASE_TYPE.tutela_primera;
}

export function getCachedStageLabel(stageCode: CaseStageCode, caseType?: CaseType): string {
  const loaded = getCachedProcessDefinitionByCaseType(caseType);
  const hit = loaded?.stages.find((s) => s.code === stageCode);
  return hit?.label ?? STAGE_LABEL_ES[stageCode] ?? stageCode;
}

export function getCachedStageDefinition(
  caseType: CaseType | undefined,
  stageCode: CaseStageCode,
): ProcessStageDefinitionRow | null {
  const loaded = getCachedProcessDefinitionByCaseType(caseType);
  if (!loaded) return null;
  return loaded.stages.find((s) => s.code === stageCode) ?? null;
}

export function getCachedStageDefinitionId(
  caseType: CaseType | undefined,
  stageCode: CaseStageCode,
): string | null {
  return getCachedStageDefinition(caseType, stageCode)?.id ?? null;
}

const DEFAULT_CASE_TERM_BUSINESS_DAYS = 10;

/** Plazo global del caso (días hábiles desde radicación). Tutela: 10 por defecto. */
export function getCachedCaseTermBusinessDays(caseType: CaseType | undefined): number {
  const def = getCachedProcessDefinitionByCaseType(caseType);
  if (def?.case_term_type === 'habiles' && def.case_term_days != null && def.case_term_days > 0) {
    return def.case_term_days;
  }
  return DEFAULT_CASE_TERM_BUSINESS_DAYS;
}

/** Plazo secundario de una etapa (contestación, impugnación, etc.) desde BD. */
export function getCachedStageTermBusinessDays(
  caseType: CaseType | undefined,
  stageCode: CaseStageCode,
): number | null {
  const stage = getCachedStageDefinition(caseType, stageCode);
  if (stage?.term_type === 'habiles' && stage.term_days != null && stage.term_days > 0) {
    return stage.term_days;
  }
  return null;
}

function rowToProcessDefinition(row: Record<string, unknown>): ProcessDefinitionRow {
  return {
    id: String(row.id ?? ''),
    code: String(row.code ?? ''),
    label: String(row.label ?? ''),
    process_domain: row.process_domain as ProcessDefinitionRow['process_domain'],
    instance_level: Number(row.instance_level ?? 1),
    case_term_days: row.case_term_days == null ? null : Number(row.case_term_days),
    case_term_type: (row.case_term_type as ProcessDefinitionRow['case_term_type']) ?? 'none',
    legacy_case_type: row.legacy_case_type == null ? null : String(row.legacy_case_type),
    is_active: row.is_active !== false,
  };
}

function rowToStageDefinition(row: Record<string, unknown>): ProcessStageDefinitionRow {
  return {
    id: String(row.id ?? ''),
    process_definition_id: String(row.process_definition_id ?? ''),
    code: String(row.code ?? ''),
    label: String(row.label ?? ''),
    order_index: Number(row.order_index ?? 0),
    stage_kind: (row.stage_kind as ProcessStageDefinitionRow['stage_kind']) ?? 'linear',
    term_days: row.term_days == null ? null : Number(row.term_days),
    term_type: (row.term_type as ProcessStageDefinitionRow['term_type']) ?? 'none',
    responsible_role: row.responsible_role as ProcessStageDefinitionRow['responsible_role'],
    generates_alert: row.generates_alert === true,
    alert_threshold_pct: Number(row.alert_threshold_pct ?? 75),
    workflow_task_type: row.workflow_task_type as ProcessStageDefinitionRow['workflow_task_type'],
  };
}

function pipelineFromStages(stages: ProcessStageDefinitionRow[]): CaseStageCode[] {
  return stages
    .filter((s) => s.stage_kind === 'linear' || s.stage_kind === 'optional')
    .sort((a, b) => a.order_index - b.order_index)
    .map((s) => s.code as CaseStageCode);
}

export async function fetchEnabledProcessDefinitions(courtId: string): Promise<LoadedProcessDefinition[]> {
  const { data: enabled, error: enErr } = await supabase
    .from('court_enabled_processes')
    .select('process_definition_id')
    .eq('court_id', courtId);

  if (enErr) {
    console.warn('[process-definitions-service] court_enabled_processes:', enErr.message);
  }

  let defQuery = supabase
    .from('process_definitions')
    .select('*')
    .eq('is_active', true);

  const enabledIds = (enabled ?? [])
    .map((r) => String((r as Record<string, unknown>).process_definition_id ?? ''))
    .filter(Boolean);

  if (enabledIds.length > 0) {
    defQuery = defQuery.in('id', enabledIds);
  } else {
    defQuery = defQuery.not('legacy_case_type', 'is', null);
  }

  const { data: defs, error: defErr } = await defQuery.order('code', { ascending: true });
  if (defErr) {
    console.warn('[process-definitions-service] process_definitions:', defErr.message);
    return [];
  }

  const rows = (defs as Record<string, unknown>[]) ?? [];
  if (!rows.length) return [];

  const ids = rows.map((r) => String(r.id));
  const { data: stages, error: stErr } = await supabase
    .from('process_stages_definition')
    .select('*')
    .in('process_definition_id', ids)
    .order('order_index', { ascending: true });

  if (stErr) {
    console.warn('[process-definitions-service] process_stages_definition:', stErr.message);
  }

  const stagesByDef = new Map<string, ProcessStageDefinitionRow[]>();
  for (const raw of (stages as Record<string, unknown>[]) ?? []) {
    const st = rowToStageDefinition(raw);
    const list = stagesByDef.get(st.process_definition_id) ?? [];
    list.push(st);
    stagesByDef.set(st.process_definition_id, list);
  }

  return filterToMvpProductScope(
    rows.map((raw) => {
      const def = rowToProcessDefinition(raw);
      const stList = stagesByDef.get(def.id) ?? [];
      const pipeline = pipelineFromStages(stList);
      return {
        ...def,
        stages: stList,
        pipeline: pipeline.length ? pipeline : (STAGE_PIPELINE_BY_CASE_TYPE[def.legacy_case_type as CaseType] ?? []),
      };
    }),
  );
}

export async function resolveProcessDefinitionId(caseType: CaseType, courtId: string): Promise<string | null> {
  if (!isMvpRadicableCaseType(caseType)) return null;
  const cached = getCachedProcessDefinitionByCaseType(caseType);
  if (cached?.id && cachedCourtId === courtId) return cached.id;

  const { data, error } = await supabase
    .from('process_definitions')
    .select('id')
    .eq('legacy_case_type', caseType)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data?.id) return null;
  return String(data.id);
}

export function getCachedCourtIdForProcessDefs(): string | null {
  return cachedCourtId;
}
