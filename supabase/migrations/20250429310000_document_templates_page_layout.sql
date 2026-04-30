-- Márgenes, tipografía y tamaño por plantilla (vista previa + .docx generado sin archivo Word propio)

alter table public.document_templates
  add column if not exists page_layout jsonb;

comment on column public.document_templates.page_layout is
  'Márgenes en mm, fontFamily y fontSizePt para vista previa y generación docx; null = valores por defecto de la app.';
