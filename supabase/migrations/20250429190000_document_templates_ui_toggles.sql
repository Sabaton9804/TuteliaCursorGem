-- Opciones condicionales por plantilla (etiquetas + estado por defecto; el cuerpo TipTap referencia toggle_id en nodos).

alter table public.document_templates
  add column if not exists template_toggles jsonb not null default '[]'::jsonb;

comment on column public.document_templates.template_toggles is
  'Lista JSON: [{ "id", "label", "description", "defaultOn", "blockContent" }]. blockContent sustituye {{id}} al generar si el toggle está activo; el cuerpo puede incluir {{id}} como marcador.';
