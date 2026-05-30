/**
 * Tipos alineados al catálogo SIERJU (migración 20260530140000_sierju_catalog_phase_s1).
 * Fase S2 usará estos enums en UI de clasificación y metadata del caso.
 */

/** Filas TIPOS PROCESOS en secciones tutela / desacato / impugnación / consulta. */
export const FUNDAMENTAL_RIGHT_CODES = [
  'salud',
  'seguridad_social',
  'vida',
  'minimo_vital',
  'igualdad',
  'educacion',
  'debido_proceso',
  'derecho_peticion',
  'informacion_publica',
  'contra_providencias_judiciales',
  'medio_ambiente',
  'otros',
] as const;

export type FundamentalRightCode = (typeof FUNDAMENTAL_RIGHT_CODES)[number];

export type SierjuSpecialty =
  | 'civil'
  | 'laboral'
  | 'familia'
  | 'constitucional'
  | 'tierras'
  | 'transversal';

export type SierjuProcedureMode = 'escrito' | 'oral';

export type SierjuUnitOfMeasure =
  | 'proceso'
  | 'tutela'
  | 'incidente'
  | 'impugnacion'
  | 'consulta'
  | 'actuacion'
  | 'audiencia'
  | 'asunto'
  | 'recurso'
  | 'persona';

export type SierjuMovementKind =
  | 'inventario_inicial'
  | 'entrada'
  | 'salida'
  | 'inventario_final'
  | 'reactivado'
  | 'acumulado'
  | 'metrica';

export type SierjuTybaMapConfidence = 'manual' | 'heuristic' | 'verified';

/** Metadatos opcionales en cases.sierju_metadata (JSONB). */
export type CaseSierjuMetadata = {
  fundamental_right?: FundamentalRightCode;
  procedure_mode?: SierjuProcedureMode;
  quantia_band?: string;
  notes?: string;
};

export type SierjuFormTemplateRow = {
  code: string;
  label: string;
  version: string;
  effective_from: string | null;
  source_document: string | null;
};

export type SierjuSectionRow = {
  id: string;
  form_template_code: string;
  code: string;
  label: string;
  specialty: SierjuSpecialty;
  instance_level: number | null;
  procedure_mode: SierjuProcedureMode | null;
  unit_of_measure: SierjuUnitOfMeasure;
  sort_order: number;
};

export type SierjuProcessClassRow = {
  id: string;
  section_id: string;
  code: string;
  label: string;
  parent_class_id: string | null;
  tyba_process_hint: string | null;
  metadata: Record<string, unknown>;
  sort_order: number;
};

export type SierjuMovementTypeRow = {
  id: string;
  section_id: string | null;
  code: string;
  label: string;
  movement_kind: SierjuMovementKind;
  is_effective: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
};
