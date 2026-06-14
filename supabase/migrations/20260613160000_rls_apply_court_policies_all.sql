-- Fase B (2/2): aplicar RLS unificado a tablas operativas + perfiles + storage.
-- depends on: 20260613150000_rls_macro_apply_court.sql

-- ---------------------------------------------------------------------------
-- Core expediente y workflow
-- ---------------------------------------------------------------------------

select public.apply_court_rls_policies ('cases');
select public.apply_case_rls_policies ('case_documents');
select public.apply_case_rls_policies ('case_actions');
select public.apply_case_rls_policies ('case_word_reviews');

select public.apply_court_rls_policies ('workflow_tasks');
select public.apply_court_rls_policies ('case_tasks');
select public.apply_court_rls_policies ('case_stages');

-- ---------------------------------------------------------------------------
-- Precedentes, plantillas, incidentes
-- ---------------------------------------------------------------------------

select public.apply_court_rls_policies ('precedents');
select public.apply_court_rls_policies ('precedent_chunks');
select public.apply_court_rls_policies ('template_variables');
select public.apply_court_rls_policies ('document_templates');
select public.apply_court_rls_policies ('incident_desacato');

-- ---------------------------------------------------------------------------
-- Integraciones y auditoría
-- ---------------------------------------------------------------------------

select public.apply_court_rls_policies ('case_sgde_folder_map');
select public.apply_case_rls_select_only ('case_audit_log');
select public.apply_case_rls_select_only ('case_document_ai_analyses');

-- court_enabled_processes (catálogo por despacho)
select public._drop_legacy_court_policies ('court_enabled_processes');
drop policy if exists court_enabled_processes_select_same_court on public.court_enabled_processes;

create policy court_enabled_processes_tenant_select
  on public.court_enabled_processes for select to authenticated
  using (public.auth_user_has_court (court_id));

-- ---------------------------------------------------------------------------
-- courts — columna de tenant es id, no court_id
-- ---------------------------------------------------------------------------

select public._drop_legacy_court_policies ('courts');

create policy courts_tenant_select
  on public.courts for select to authenticated
  using (public.auth_user_has_court (id));

create policy courts_tenant_update
  on public.courts for update to authenticated
  using (public.auth_user_has_court (id))
  with check (public.auth_user_has_court (id));

-- INSERT courts: solo service_role / SQL admin (sin policy authenticated)

-- ---------------------------------------------------------------------------
-- profiles — políticas propias + mismo despacho (membresía M:N)
-- ---------------------------------------------------------------------------

select public._drop_legacy_court_policies ('profiles');
-- Mantener own policies; reemplazar same_court / superuser

drop policy if exists profiles_select_same_court on public.profiles;
drop policy if exists profiles_select_superuser on public.profiles;

create policy profiles_select_same_court
  on public.profiles for select to authenticated
  using (public.auth_user_has_court (court_id));

-- profiles_insert_own / profiles_update_own sin cambio (auth.uid() = id)

-- ---------------------------------------------------------------------------
-- profile_court_memberships
-- ---------------------------------------------------------------------------

drop policy if exists profile_court_memberships_select_own on public.profile_court_memberships;

create policy profile_court_memberships_select_own
  on public.profile_court_memberships for select to authenticated
  using (
    profile_id = auth.uid ()
    or public.is_platform_admin ()
    or public.auth_user_has_court (court_id)
  );

create policy profile_court_memberships_insert_admin
  on public.profile_court_memberships for insert to authenticated
  with check (
    public.is_platform_admin ()
    or (
      public.auth_user_has_court (court_id)
      and (
        exists (
          select 1
          from public.profile_court_memberships m
          where m.profile_id = auth.uid ()
            and m.court_id = court_id
            and m.role = 'admin'
        )
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid ()
            and p.court_id = court_id
            and p.role = 'admin'
        )
      )
    )
  );

create policy profile_court_memberships_update_admin
  on public.profile_court_memberships for update to authenticated
  using (
    public.is_platform_admin ()
    or (
      public.auth_user_has_court (court_id)
      and (
        exists (
          select 1
          from public.profile_court_memberships m
          where m.profile_id = auth.uid ()
            and m.court_id = court_id
            and m.role = 'admin'
        )
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid ()
            and p.court_id = court_id
            and p.role = 'admin'
        )
      )
    )
  )
  with check (
    public.is_platform_admin ()
    or public.auth_user_has_court (court_id)
  );

create policy profile_court_memberships_delete_admin
  on public.profile_court_memberships for delete to authenticated
  using (
    public.is_platform_admin ()
    or (
      public.auth_user_has_court (court_id)
      and (
        exists (
          select 1
          from public.profile_court_memberships m
          where m.profile_id = auth.uid ()
            and m.court_id = court_id
            and m.role = 'admin'
        )
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid ()
            and p.court_id = court_id
            and p.role = 'admin'
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- user_notifications — conservar select/update propios; insert por despacho
-- ---------------------------------------------------------------------------

drop policy if exists user_notifications_insert_same_court on public.user_notifications;

create policy user_notifications_insert_same_court
  on public.user_notifications for insert to authenticated
  with check (
    public.auth_user_has_court (court_id)
    and exists (
      select 1
      from public.cases c
      where c.id = case_id
        and c.court_id = user_notifications.court_id
    )
    and (
      exists (
        select 1
        from public.profile_court_memberships m
        where m.profile_id = recipient_user_id
          and m.court_id = user_notifications.court_id
      )
      or exists (
        select 1
        from public.profiles p
        where p.id = recipient_user_id
          and p.court_id = user_notifications.court_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- court_mailboxes + outlook (idempotente)
-- ---------------------------------------------------------------------------

drop policy if exists court_mailboxes_select_member on public.court_mailboxes;

create policy court_mailboxes_tenant_select
  on public.court_mailboxes for select to authenticated
  using (public.auth_user_has_court (court_id));

create policy court_mailboxes_tenant_insert
  on public.court_mailboxes for insert to authenticated
  with check (public.auth_user_has_court (court_id));

create policy court_mailboxes_tenant_update
  on public.court_mailboxes for update to authenticated
  using (public.auth_user_has_court (court_id))
  with check (public.auth_user_has_court (court_id));

create policy court_mailboxes_tenant_delete
  on public.court_mailboxes for delete to authenticated
  using (public.auth_user_has_court (court_id));

select public.apply_court_rls_policies ('outlook_message_reviews');

-- ---------------------------------------------------------------------------
-- Storage case-documents: cases/{case_id}/...
-- ---------------------------------------------------------------------------

drop policy if exists "case_documents_storage_select" on storage.objects;
drop policy if exists "case_documents_storage_insert" on storage.objects;
drop policy if exists "case_documents_storage_update" on storage.objects;
drop policy if exists "case_documents_storage_delete" on storage.objects;
drop policy if exists "case_documents_storage_select_superuser" on storage.objects;
drop policy if exists "case_documents_storage_insert_superuser" on storage.objects;
drop policy if exists "case_documents_storage_update_superuser" on storage.objects;
drop policy if exists "case_documents_storage_delete_superuser" on storage.objects;

create policy "case_documents_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'case-documents'
    and public.auth_user_has_case (split_part(name, '/', 2)::uuid)
  );

create policy "case_documents_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'case-documents'
    and public.auth_user_has_case (split_part(name, '/', 2)::uuid)
  );

create policy "case_documents_storage_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'case-documents'
    and public.auth_user_has_case (split_part(name, '/', 2)::uuid)
  )
  with check (
    bucket_id = 'case-documents'
    and public.auth_user_has_case (split_part(name, '/', 2)::uuid)
  );

create policy "case_documents_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'case-documents'
    and public.auth_user_has_case (split_part(name, '/', 2)::uuid)
  );
