/**
 * Tipos alineados a process_definitions / process_stages_definition (Fase 1 SQL).
 * El runtime sigue en case-workflow-stages.ts hasta Fase 2.
 */

export type ProcessDomain =
  | 'constitucional'
  | 'civil'
  | 'laboral'
  | 'penal'
  | 'familia'
  | 'administrativo'
  | 'transversal';

export type ProcessTermType = 'habiles' | 'calendario' | 'none';

export type ProcessStageKind = 'linear' | 'branch' | 'terminal' | 'optional';

export type ProcessStageResponsibleRole = 'secretaria' | 'despacho';

export type ProcessWorkflowTaskType = 'custom' | 'generate_notifs';

/** Fila de public.process_definitions (subset usado en app). */
export type ProcessDefinitionRow = {
  id: string;
  code: string;
  label: string;
  process_domain: ProcessDomain;
  instance_level: number;
  case_term_days: number | null;
  case_term_type: ProcessTermType;
  legacy_case_type: string | null;
  is_active: boolean;
};

/** Fila de public.process_stages_definition. */
export type ProcessStageDefinitionRow = {
  id: string;
  process_definition_id: string;
  code: string;
  label: string;
  order_index: number;
  stage_kind: ProcessStageKind;
  term_days: number | null;
  term_type: ProcessTermType;
  responsible_role: ProcessStageResponsibleRole | null;
  generates_alert: boolean;
  alert_threshold_pct: number;
  workflow_task_type: ProcessWorkflowTaskType | null;
};

/** Configuración CUI de un despacho (public.courts). */
export type CourtRadicacionConfig = {
  courtId: string;
  daneCode: string;
  entityCode: string;
  specialtyCode: string;
  despachoNumber: string;
  displayName: string;
};
