import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaseType, UserRole } from '../types';
import {
  assignedToMatchesProfile,
  findStaffByAssignedValue,
  normalizeStaffKey,
} from './court-staff-assignees';

/** Códigos de etapa alineados con `public.case_stages.stage_code` (CHECK en migración). */
export type CaseStageCode =
  | 'RADICACION'
  | 'ADMISION'
  | 'INADMISION'
  | 'RECHAZO'
  | 'NOTIFICACION_AUTO_ADMISORIO'
  | 'TERMINO_RESPUESTA'
  | 'INGRESO_DESPACHO_FALLO'
  | 'FALLO'
  | 'NOTIFICACION_FALLO'
  | 'TERMINO_IMPUGNACION'
  | 'IMPUGNACION'
  | 'REMISION_SUPERIOR'
  | 'EJECUTORIA'
  | 'REMISION_CORTE'
  | 'CUMPLIMIENTO'
  | 'INCIDENTE_DESACATO';

export type CaseStageResponsibleRole = 'secretaria' | 'despacho';

export const STAGE_PIPELINE_BY_CASE_TYPE: Record<
  CaseType,
  readonly CaseStageCode[]
> = {
  tutela_primera: [
    'RADICACION',
    'ADMISION',
    'NOTIFICACION_AUTO_ADMISORIO',
    'TERMINO_RESPUESTA',
    'INGRESO_DESPACHO_FALLO',
    'FALLO',
    'NOTIFICACION_FALLO',
    'TERMINO_IMPUGNACION',
    'EJECUTORIA',
    'REMISION_CORTE',
  ],
  tutela_segunda: [
    'RADICACION',
    'INGRESO_DESPACHO_FALLO',
    'FALLO',
    'NOTIFICACION_FALLO',
    'EJECUTORIA',
    'REMISION_CORTE',
  ],
  consulta_desacato: [
    'RADICACION',
    'INGRESO_DESPACHO_FALLO',
    'FALLO',
    'NOTIFICACION_FALLO',
    'EJECUTORIA',
  ],
};

const SECRETARIA_STAGES = new Set<CaseStageCode>([
  'RADICACION',
  'NOTIFICACION_AUTO_ADMISORIO',
  'TERMINO_RESPUESTA',
  'NOTIFICACION_FALLO',
  'TERMINO_IMPUGNACION',
  'REMISION_CORTE',
]);

const DESPACHO_STAGES = new Set<CaseStageCode>([
  'ADMISION',
  'INGRESO_DESPACHO_FALLO',
  'FALLO',
  'EJECUTORIA',
]);

export function responsibleRoleForStage(stage: CaseStageCode): CaseStageResponsibleRole {
  if (DESPACHO_STAGES.has(stage)) return 'despacho';
  return 'secretaria';
}

export const STAGE_LABEL_ES: Record<CaseStageCode, string> = {
  RADICACION: 'Radicación',
  ADMISION: 'Admisión',
  INADMISION: 'Inadmisión',
  RECHAZO: 'Rechazo',
  NOTIFICACION_AUTO_ADMISORIO: 'Notificación auto admisorio',
  TERMINO_RESPUESTA: 'Término de respuesta',
  INGRESO_DESPACHO_FALLO: 'Ingreso despacho / fallo',
  FALLO: 'Fallo',
  NOTIFICACION_FALLO: 'Notificación del fallo',
  TERMINO_IMPUGNACION: 'Término de impugnación',
  IMPUGNACION: 'Impugnación',
  REMISION_SUPERIOR: 'Remisión superior',
  EJECUTORIA: 'Ejecutoria',
  REMISION_CORTE: 'Remisión a Corte',
  CUMPLIMIENTO: 'Cumplimiento',
  INCIDENTE_DESACATO: 'Incidente de desacato',
};

export function pipelineForCaseType(caseType: CaseType | undefined): readonly CaseStageCode[] {
  const t = caseType ?? 'tutela_primera';
  return STAGE_PIPELINE_BY_CASE_TYPE[t] ?? STAGE_PIPELINE_BY_CASE_TYPE.tutela_primera;
}

export function nextStageInPipeline(
  pipeline: readonly CaseStageCode[],
  current: CaseStageCode,
): CaseStageCode | null {
  const i = pipeline.indexOf(current);
  if (i < 0 || i >= pipeline.length - 1) return null;
  return pipeline[i + 1] ?? null;
}

const SECRETARIA_ROLE_PRIORITY: UserRole[] = [
  'clerk',
  'escribiente',
  'official',
  'asistente_judicial',
  'admin',
];

const DESPACHO_ROLE_PRIORITY: UserRole[] = ['judge', 'sustanciador', 'admin'];

function roleRank(role: UserRole, order: readonly UserRole[]): number {
  const i = order.indexOf(role);
  return i === -1 ? 999 : i;
}

/**
 * Resuelve un `auth.users` id del mismo despacho para asignar la tarea de flujo.
 */
export async function resolveWorkflowAssigneeId(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    role: CaseStageResponsibleRole;
    caseAssignedTo?: string | null;
  },
): Promise<string | null> {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('court_id', opts.courtId);
  if (error || !profiles?.length) {
    console.error('resolveWorkflowAssigneeId profiles:', error);
    return null;
  }

  const rows = profiles as Array<{ id: string; name: string; email: string | null; role: string }>;
  const pool =
    opts.role === 'despacho'
      ? rows.filter((p) => DESPACHO_ROLE_PRIORITY.includes(p.role as UserRole))
      : rows.filter((p) => SECRETARIA_ROLE_PRIORITY.includes(p.role as UserRole));

  const order = opts.role === 'despacho' ? DESPACHO_ROLE_PRIORITY : SECRETARIA_ROLE_PRIORITY;

  if (opts.role === 'despacho' && opts.caseAssignedTo?.trim()) {
    const at = opts.caseAssignedTo.trim();
    const staff = findStaffByAssignedValue(at);
    const hit = pool.find((p) => {
      if (assignedToMatchesProfile(at, p.name)) return true;
      const em = (p.email || '').trim();
      if (!em || !staff?.emails?.length) return false;
      return staff.emails.some((e) => normalizeStaffKey(e) === normalizeStaffKey(em));
    });
    if (hit) return hit.id;
  }

  const sorted = [...pool].sort((a, b) => {
    const ra = roleRank(a.role as UserRole, order);
    const rb = roleRank(b.role as UserRole, order);
    if (ra !== rb) return ra - rb;
    return (a.name || '').localeCompare(b.name || '', 'es');
  });

  return sorted[0]?.id ?? rows[0]?.id ?? null;
}

export function workflowTaskPayloadForStage(
  stage: CaseStageCode,
  radicado: string,
): { title: string; description: string; task_type: 'custom' } {
  const label = STAGE_LABEL_ES[stage];
  return {
    title: `Trámite: ${label}`,
    description: `Acción pendiente en la etapa «${label}» del expediente ${radicado}.`,
    task_type: 'custom',
  };
}
