/**
 * Columnas PostgREST para listados (dashboard y expedientes).
 * Excluye blobs pesados (raw_text, raw_html, legal_hechos, etc.) que no usan las tablas/vistas de lista.
 */
/** Listados generales (dashboard, tutelas): sin jsonb pesado. */
export const CASE_LIST_COLUMNS = [
  'id',
  'court_id',
  'radicado',
  'claimant',
  'defendant',
  'status',
  'operational_status',
  'assigned_to',
  'created_at',
  'updated_at',
  'deadline_at',
  'sgde_id',
  'source_channel',
  'subject',
  'legal_derecho_tutelado',
  'derecho_tutelado_code',
  'sierju_process_class_id',
  'decision_type',
  'decision_at',
  'case_type',
  'process_definition_id',
].join(',');

/** Catálogo Procesos: incluye metadatos importados de plataforma. */
export const CASE_PROCESOS_LIST_COLUMNS = [
  ...CASE_LIST_COLUMNS.split(','),
  'catalog_metadata',
].join(',');
