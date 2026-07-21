import { supabase } from './supabase';
import type { CourtProcessStageRow, ProcessStageDefinitionRow, ProcessTermType } from './process-definition-types';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';

function rowToCourtStage(row: Record<string, unknown>): CourtProcessStageRow {
  return {
    id: String(row.id ?? ''),
    court_id: String(row.court_id ?? ''),
    process_definition_id: String(row.process_definition_id ?? ''),
    stage_code: String(row.stage_code ?? ''),
    label: String(row.label ?? ''),
    order_index: Number(row.order_index ?? 0),
    is_hidden: row.is_hidden === true,
    is_custom: row.is_custom === true,
    source_stage_definition_id:
      row.source_stage_definition_id == null ? null : String(row.source_stage_definition_id),
    responsible_role: (row.responsible_role as CourtProcessStageRow['responsible_role']) ?? null,
    term_days: row.term_days == null ? null : Number(row.term_days),
    term_type: (row.term_type as ProcessTermType) ?? 'none',
  };
}

/** Convierte etiqueta libre a CUSTOM_SLUG (máx. ~40 chars útiles). */
export function slugCustomStageCode(label: string): string {
  const base = (label || 'ETAPA')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  const slug = base || 'ETAPA';
  return `CUSTOM_${slug}`;
}

export async function fetchCourtProcessStages(
  courtId: string,
  processDefinitionId: string,
): Promise<CourtProcessStageRow[]> {
  const { data, error } = await supabase
    .from('court_process_stages')
    .select('*')
    .eq('court_id', courtId)
    .eq('process_definition_id', processDefinitionId)
    .order('order_index', { ascending: true });

  if (error) {
    console.warn('[court-process-stages] fetch:', error.message);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map(rowToCourtStage);
}

export async function fetchCourtProcessStagesForDefs(
  courtId: string,
  processDefinitionIds: string[],
): Promise<Map<string, CourtProcessStageRow[]>> {
  const out = new Map<string, CourtProcessStageRow[]>();
  if (!processDefinitionIds.length) return out;

  const { data, error } = await supabase
    .from('court_process_stages')
    .select('*')
    .eq('court_id', courtId)
    .in('process_definition_id', processDefinitionIds)
    .order('order_index', { ascending: true });

  if (error) {
    console.warn('[court-process-stages] fetchForDefs:', error.message);
    return out;
  }

  for (const raw of (data as Record<string, unknown>[]) ?? []) {
    const row = rowToCourtStage(raw);
    const list = out.get(row.process_definition_id) ?? [];
    list.push(row);
    out.set(row.process_definition_id, list);
  }
  return out;
}

export function plantillaToCourtDraft(
  courtId: string,
  processDefinitionId: string,
  plantilla: ProcessStageDefinitionRow[],
): Omit<CourtProcessStageRow, 'id'>[] {
  return [...plantilla]
    .sort((a, b) => a.order_index - b.order_index)
    .map((s, i) => ({
      court_id: courtId,
      process_definition_id: processDefinitionId,
      stage_code: s.code,
      label: s.label,
      order_index: i,
      is_hidden: false,
      is_custom: false,
      source_stage_definition_id: s.id || null,
      responsible_role: s.responsible_role,
      term_days: s.term_days,
      term_type: s.term_type,
    }));
}

/** Si no hay filas court, copia la plantilla y las inserta. Devuelve el carril del juzgado. */
export async function ensureCourtProcessStagesSeeded(
  courtId: string,
  processDefinitionId: string,
  plantilla: ProcessStageDefinitionRow[],
): Promise<CourtProcessStageRow[]> {
  const existing = await fetchCourtProcessStages(courtId, processDefinitionId);
  if (existing.length) return existing;

  await ensureSupabaseSessionForWrites();
  const draft = plantillaToCourtDraft(courtId, processDefinitionId, plantilla);
  if (!draft.length) return [];

  const { data, error } = await supabase
    .from('court_process_stages')
    .insert(
      draft.map((d) => ({
        court_id: d.court_id,
        process_definition_id: d.process_definition_id,
        stage_code: d.stage_code,
        label: d.label,
        order_index: d.order_index,
        is_hidden: d.is_hidden,
        is_custom: d.is_custom,
        source_stage_definition_id: d.source_stage_definition_id,
        responsible_role: d.responsible_role,
        term_days: d.term_days,
        term_type: d.term_type,
      })),
    )
    .select('*');

  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[]) ?? []).map(rowToCourtStage);
}

export type CourtStageEditorItem = {
  /** Id BD o temp- para filas nuevas no guardadas */
  id: string;
  stage_code: string;
  label: string;
  order_index: number;
  is_hidden: boolean;
  is_custom: boolean;
  source_stage_definition_id: string | null;
  responsible_role: CourtProcessStageRow['responsible_role'];
  term_days: number | null;
  term_type: ProcessTermType;
};

/** Reemplaza el carril del proceso en el juzgado (delete + insert ordenado). */
export async function replaceCourtProcessStages(
  courtId: string,
  processDefinitionId: string,
  items: CourtStageEditorItem[],
): Promise<CourtProcessStageRow[]> {
  await ensureSupabaseSessionForWrites();

  const codes = new Set<string>();
  for (const it of items) {
    if (!/^[A-Z0-9_]+$/.test(it.stage_code)) {
      throw new Error(`Código de etapa inválido: ${it.stage_code}`);
    }
    if (codes.has(it.stage_code)) {
      throw new Error(`Código duplicado: ${it.stage_code}`);
    }
    codes.add(it.stage_code);
  }

  const { error: delErr } = await supabase
    .from('court_process_stages')
    .delete()
    .eq('court_id', courtId)
    .eq('process_definition_id', processDefinitionId);
  if (delErr) throw new Error(delErr.message);

  const sorted = [...items].sort((a, b) => a.order_index - b.order_index);
  const payload = sorted.map((it, i) => ({
    court_id: courtId,
    process_definition_id: processDefinitionId,
    stage_code: it.stage_code,
    label: it.label.trim() || it.stage_code,
    order_index: i,
    is_hidden: it.is_hidden,
    is_custom: it.is_custom,
    source_stage_definition_id: it.is_custom ? null : it.source_stage_definition_id,
    responsible_role: it.responsible_role,
    term_days: it.term_days,
    term_type: it.term_type ?? 'none',
    updated_at: new Date().toISOString(),
  }));

  if (!payload.length) return [];

  const { data, error } = await supabase.from('court_process_stages').insert(payload).select('*');
  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[]) ?? []).map(rowToCourtStage);
}

/** Borra overrides y vuelve a sembrar desde plantilla. */
export async function restoreCourtProcessStagesFromTemplate(
  courtId: string,
  processDefinitionId: string,
  plantilla: ProcessStageDefinitionRow[],
): Promise<CourtProcessStageRow[]> {
  await ensureSupabaseSessionForWrites();
  const { error: delErr } = await supabase
    .from('court_process_stages')
    .delete()
    .eq('court_id', courtId)
    .eq('process_definition_id', processDefinitionId);
  if (delErr) throw new Error(delErr.message);
  return ensureCourtProcessStagesSeeded(courtId, processDefinitionId, plantilla);
}
