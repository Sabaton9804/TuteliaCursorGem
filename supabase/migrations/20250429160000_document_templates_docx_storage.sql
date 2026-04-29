-- Plantillas Word (.docx) subidas por despacho (detección IA + docxtemplater)

alter table public.document_templates
  add column if not exists docx_storage_path text;

alter table public.document_templates
  add column if not exists docx_mapeo jsonb;

comment on column public.document_templates.docx_storage_path is
  'Ruta en bucket document-templates (sin prefijo). Si está definida, la generación usa docxtemplater sobre este archivo.';

comment on column public.document_templates.docx_mapeo is
  'Último mapeo confirmado por el admin [{original, marcador}] (auditoría / vista previa).';

insert into storage.buckets (id, name, public, file_size_limit)
values ('document-templates', 'document-templates', false, 15728640)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = coalesce(excluded.file_size_limit, storage.buckets.file_size_limit);

drop policy if exists "document_templates_storage_select" on storage.objects;
drop policy if exists "document_templates_storage_insert" on storage.objects;
drop policy if exists "document_templates_storage_update" on storage.objects;
drop policy if exists "document_templates_storage_delete" on storage.objects;

create policy "document_templates_storage_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'document-templates');

create policy "document_templates_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'document-templates');

create policy "document_templates_storage_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'document-templates')
  with check (bucket_id = 'document-templates');

create policy "document_templates_storage_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'document-templates');
