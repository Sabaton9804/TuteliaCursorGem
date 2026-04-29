-- Buckets y columna para anexos de expediente en Supabase Storage.
-- Ejecutar con: supabase db push  o  SQL Editor
--
-- Huérfanos: eliminar filas en public.cases / public.case_documents NO borra objetos en
-- este bucket. A futuro: Edge Function + Database Webhook (DELETE) o job de reconciliación.
--
-- file_size_limit 50 MB: buen default para PDF civiles. Vídeo / escaneos masivos: subir
-- límite en Dashboard (Storage → case-documents → Configuration) o cambiar el valor aquí.

-- Ruta del objeto: cases/{case_id}/{uuid}_{nombreSeguro}

alter table public.case_documents
  add column if not exists storage_path text;

comment on column public.case_documents.storage_path is 'Ruta en el bucket case-documents (sin prefijo bucket). Contenido binario preferiblemente solo en Storage.';

insert into storage.buckets (id, name, public, file_size_limit)
values ('case-documents', 'case-documents', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = coalesce(excluded.file_size_limit, storage.buckets.file_size_limit);

-- Políticas: mismo alcance que RLS permisiva en tablas (authenticated).
-- Endurecer por court_id / path cuando exista membresía real.

drop policy if exists "case_documents_storage_select" on storage.objects;
drop policy if exists "case_documents_storage_insert" on storage.objects;
drop policy if exists "case_documents_storage_update" on storage.objects;
drop policy if exists "case_documents_storage_delete" on storage.objects;

create policy "case_documents_storage_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'case-documents');

create policy "case_documents_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'case-documents');

create policy "case_documents_storage_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'case-documents')
  with check (bucket_id = 'case-documents');

create policy "case_documents_storage_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'case-documents');
