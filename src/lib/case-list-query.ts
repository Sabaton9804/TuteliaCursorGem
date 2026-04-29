/**
 * Columnas PostgREST para listados (dashboard y expedientes).
 * Excluye blobs pesados (raw_text, raw_html, legal_hechos, etc.) que no usan las tablas/vistas de lista.
 */
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
  'decision_type',
].join(',');
