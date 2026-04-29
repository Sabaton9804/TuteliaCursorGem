-- Endurece RLS de document_templates por membresia al mismo despacho (court_id).
-- Evita falsos positivos de escritura cuando la fila no pertenece al court del usuario.

alter table public.document_templates enable row level security;

drop policy if exists document_templates_authenticated_all on public.document_templates;
drop policy if exists document_templates_select_same_court on public.document_templates;
drop policy if exists document_templates_insert_same_court on public.document_templates;
drop policy if exists document_templates_update_same_court on public.document_templates;
drop policy if exists document_templates_delete_same_court on public.document_templates;

create policy document_templates_select_same_court
  on public.document_templates for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles viewer
      where viewer.id = auth.uid()
        and viewer.court_id = document_templates.court_id
    )
  );

create policy document_templates_insert_same_court
  on public.document_templates for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles viewer
      where viewer.id = auth.uid()
        and viewer.court_id = document_templates.court_id
    )
  );

create policy document_templates_update_same_court
  on public.document_templates for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles viewer
      where viewer.id = auth.uid()
        and viewer.court_id = document_templates.court_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles viewer
      where viewer.id = auth.uid()
        and viewer.court_id = document_templates.court_id
    )
  );

create policy document_templates_delete_same_court
  on public.document_templates for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles viewer
      where viewer.id = auth.uid()
        and viewer.court_id = document_templates.court_id
    )
  );
