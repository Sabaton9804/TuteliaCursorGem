-- Tutelia multi-tenant Fase A+B
-- Ejecutar UNA VEZ en Supabase SQL Editor


-- =============================================================================
-- supabase/migrations/20260613120000_platform_admins.sql
-- =============================================================================

-- Fase A evolutiva (1/3): administradores de plataforma + auditoría.
-- depends on: 20260526120000_profiles_superuser.sql
-- depends on: 20250428120000_tutelia_core.sql (courts)

-- ---------------------------------------------------------------------------
-- platform_admins — identidad formal del operador SaaS / Rama
-- ---------------------------------------------------------------------------

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  notes text
);

comment on table public.platform_admins is
  'Administradores de plataforma (consola /plataforma). Sustituye gradualmente profiles.is_superuser.';

-- ---------------------------------------------------------------------------
-- is_platform_admin — unifica platform_admins + is_superuser (transición)
-- Definir ANTES de políticas RLS que lo referencian.
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid ()
  )
  or coalesce(
    (
      select p.is_superuser
      from public.profiles p
      where p.id = auth.uid ()
    ),
    false
  );
$$;

comment on function public.is_platform_admin () is
  'True si el usuario es admin de plataforma (platform_admins o profiles.is_superuser durante transición).';

alter table public.platform_admins enable row level security;

create policy platform_admins_select_admin on public.platform_admins
  for select to authenticated
  using (public.is_platform_admin ());

create policy platform_admins_insert_admin on public.platform_admins
  for insert to authenticated
  with check (public.is_platform_admin ());

create policy platform_admins_delete_admin on public.platform_admins
  for delete to authenticated
  using (public.is_platform_admin ());

-- Políticas RLS existentes usan auth_is_superuser(); delegar para no duplicar bypass.
create or replace function public.auth_is_superuser ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin ();
$$;

comment on function public.auth_is_superuser () is
  'Alias de is_platform_admin() para políticas RLS legacy. Deprecar nombre en favor de is_platform_admin.';

-- Backfill: superusuarios actuales → platform_admins
insert into public.platform_admins (user_id, notes)
select p.id, 'Migrado desde profiles.is_superuser'
from public.profiles p
where p.is_superuser = true
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- platform_audit_log — acciones sensibles de consola (viewAs, altas, etc.)
-- ---------------------------------------------------------------------------

create table if not exists public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  target_court_id text references public.courts (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_log_user_created_idx
  on public.platform_audit_log (user_id, created_at desc);

create index if not exists platform_audit_log_court_created_idx
  on public.platform_audit_log (target_court_id, created_at desc)
  where target_court_id is not null;

comment on table public.platform_audit_log is
  'Auditoría de acciones de platform admin (view_as, court_created, user_invited, …).';

alter table public.platform_audit_log enable row level security;

create policy platform_audit_log_select_admin on public.platform_audit_log
  for select to authenticated
  using (public.is_platform_admin ());

create policy platform_audit_log_insert_self on public.platform_audit_log
  for insert to authenticated
  with check (
    user_id = auth.uid ()
    and public.is_platform_admin ()
  );

-- RPC para registrar desde app (Fase B/C)
create or replace function public.log_platform_action (
  p_action text,
  p_target_court_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_admin () then
    raise exception 'Solo platform admin puede registrar auditoría de plataforma';
  end if;

  insert into public.platform_audit_log (user_id, action, target_court_id, metadata)
  values (auth.uid (), p_action, p_target_court_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_platform_action (text, text, jsonb) is
  'Inserta fila en platform_audit_log. Usar desde consola al setear viewAs o provisionar despachos.';

-- =============================================================================
-- supabase/migrations/20260613130000_courts_platform_fields.sql
-- =============================================================================

-- Fase A evolutiva (2/3): campos consola platform + búsqueda trgm en courts.
-- depends on: 20260529120000_judicial_process_platform_phase1.sql (territory_id, judicial_specialty_id)
-- depends on: 20250428120000_tutelia_core.sql (courts)

-- ---------------------------------------------------------------------------
-- Estado operativo del despacho (consola /plataforma)
-- ---------------------------------------------------------------------------

alter table public.courts
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  add column if not exists official_name text;

comment on column public.courts.status is
  'Estado en consola platform: active | inactive | suspended.';
comment on column public.courts.official_name is
  'Nombre oficial TYBA/Rama si difiere del name corto en UI.';

create index if not exists courts_status_idx on public.courts (status);

create index if not exists courts_platform_filter_idx
  on public.courts (status, territory_id, judicial_specialty_id, entity_category_id);

-- ---------------------------------------------------------------------------
-- Código CUI despacho (12 dígitos: DANE + entidad + especialidad + número)
-- ---------------------------------------------------------------------------

create or replace function public.court_cui_official_code (p_court_id text)
returns text
language sql
stable
set search_path = public
as $$
  select
    coalesce(nullif(trim(c.dane_code), ''), '')
    || coalesce(nullif(trim(c.entity_code), ''), '')
    || coalesce(nullif(trim(c.specialty_code), ''), '')
    || coalesce(nullif(trim(c.despacho_number), ''), '')
  from public.courts c
  where c.id = p_court_id;
$$;

comment on function public.court_cui_official_code (text) is
  'CUI despacho sin año (12 chars). Upsert en bulk import por este valor compuesto.';

-- ---------------------------------------------------------------------------
-- Búsqueda pg_trgm (5000+ despachos en consola)
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm;

create index if not exists courts_name_trgm_idx
  on public.courts using gin (name gin_trgm_ops);

create index if not exists courts_official_name_trgm_idx
  on public.courts using gin (official_name gin_trgm_ops)
  where official_name is not null;

create index if not exists courts_id_trgm_idx
  on public.courts using gin (id gin_trgm_ops);

-- Expresión indexable para búsqueda por CUI parcial (consola Fase C)
create index if not exists courts_cui_expr_trgm_idx
  on public.courts using gin (
    (
      coalesce(dane_code, '')
      || coalesce(entity_code, '')
      || coalesce(specialty_code, '')
      || coalesce(despacho_number, '')
    ) gin_trgm_ops
  )
  where dane_code is not null;

-- =============================================================================
-- supabase/migrations/20260613140000_rls_helpers_unified.sql
-- =============================================================================

-- Fase A evolutiva (3/3): helpers RLS unificados (court_id text, membresía M:N).
-- depends on: 20260605120000_court_mailboxes_shared.sql (auth_user_has_court)
-- depends on: 20260613120000_platform_admins.sql (is_platform_admin)

-- ---------------------------------------------------------------------------
-- current_court_id — despacho activo del funcionario
-- Precedencia: membresía default → profiles.court_id (legacy)
-- viewAs (platform admin) se resuelve en capa app (Fase B); no en JWT aún.
-- ---------------------------------------------------------------------------

create or replace function public.current_court_id ()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.court_id
      from public.profile_court_memberships m
      where m.profile_id = auth.uid ()
        and m.is_default = true
      limit 1
    ),
    (
      select nullif(trim(p.court_id), '')
      from public.profiles p
      where p.id = auth.uid ()
      limit 1
    )
  );
$$;

comment on function public.current_court_id () is
  'Despacho operativo del usuario: profile_court_memberships.is_default o profiles.court_id.';

-- ---------------------------------------------------------------------------
-- auth_user_has_court — acceso a filas de un despacho
-- Platform admin: bypass total (RLS). Staff: membresía M:N o perfil legacy.
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_has_court (p_court_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_court_id is not null
    and length(trim(p_court_id)) > 0
    and (
      public.is_platform_admin ()
      or exists (
        select 1
        from public.profile_court_memberships m
        where m.profile_id = auth.uid ()
          and m.court_id = p_court_id
      )
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid ()
          and p.court_id = p_court_id
      )
    );
$$;

comment on function public.auth_user_has_court (text) is
  'True si platform admin o el usuario pertenece al despacho (membresía o court_id legacy).';

-- ---------------------------------------------------------------------------
-- auth_user_has_case — tablas sin court_id directo (case_documents, etc.)
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_has_case (p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = p_case_id
      and public.auth_user_has_court (c.court_id)
  );
$$;

comment on function public.auth_user_has_case (uuid) is
  'True si el usuario puede acceder al expediente (vía court_id del case).';

-- ---------------------------------------------------------------------------
-- Inventario Fase B — tablas con court_id aún en patrón profiles join legacy
-- (grep 20260613 — NO migrar en este turno; apply_court_rls_policies en Fase 2)
-- ---------------------------------------------------------------------------
-- cases, case_documents, case_actions, case_word_reviews, courts
-- workflow_tasks, case_tasks, case_stages, precedents, precedent_chunks
-- incident_desacato, template_variables, document_templates
-- user_notifications, case_audit_log, case_document_ai_analyses
-- case_sgde_folder_map, court_enabled_processes
-- outlook_message_reviews (OK: auth_user_has_court)
-- court_mailboxes (OK: auth_user_has_court)
-- profile_court_memberships (solo select own — ampliar en Fase 2)

-- =============================================================================
-- supabase/migrations/20260613150000_rls_macro_apply_court.sql
-- =============================================================================

-- Fase B (1/2): macros RLS reutilizables por court_id y case_id.
-- depends on: 20260613140000_rls_helpers_unified.sql

-- ---------------------------------------------------------------------------
-- Elimina políticas legacy de una tabla (same_court, superuser, court_all, authenticated_all)
-- ---------------------------------------------------------------------------

create or replace function public._drop_legacy_court_policies (p_table name)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = p_table
      and (
        policyname like '%\_same\_court' escape '\'
        or policyname like '%\_superuser' escape '\'
        or policyname like '%\_court\_all' escape '\'
        or policyname like '%\_authenticated\_all' escape '\'
        or policyname like '%\_select\_member' escape '\'
        or policyname like '%\_tenant\_%' escape '\'
      )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, p_table);
  end loop;
end;
$$;

comment on function public._drop_legacy_court_policies (name) is
  'Helper interno: quita políticas RLS legacy antes de apply_court_rls_policies.';

-- ---------------------------------------------------------------------------
-- Tablas con columna court_id directa
-- ---------------------------------------------------------------------------

create or replace function public.apply_court_rls_policies (
  p_table name,
  p_court_column name default 'court_id'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qual text;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    raise notice 'apply_court_rls_policies: tabla public.% no existe — omitida', p_table;
    return;
  end if;

  perform public._drop_legacy_court_policies (p_table);

  execute format('alter table public.%I enable row level security', p_table);

  v_qual := format('public.auth_user_has_court(%I)', p_court_column);

  execute format(
    'create policy %I on public.%I for select to authenticated using (%s)',
    p_table || '_tenant_select',
    p_table,
    v_qual
  );

  execute format(
    'create policy %I on public.%I for insert to authenticated with check (%s)',
    p_table || '_tenant_insert',
    p_table,
    v_qual
  );

  execute format(
    'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
    p_table || '_tenant_update',
    p_table,
    v_qual,
    v_qual
  );

  execute format(
    'create policy %I on public.%I for delete to authenticated using (%s)',
    p_table || '_tenant_delete',
    p_table,
    v_qual
  );
end;
$$;

comment on function public.apply_court_rls_policies (name, name) is
  'Aplica SELECT/INSERT/UPDATE/DELETE por tenant usando auth_user_has_court(court_column).';

-- ---------------------------------------------------------------------------
-- Tablas enlazadas por case_id (sin court_id en fila)
-- ---------------------------------------------------------------------------

create or replace function public.apply_case_rls_policies (
  p_table name,
  p_case_column name default 'case_id'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qual text;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    raise notice 'apply_case_rls_policies: tabla public.% no existe — omitida', p_table;
    return;
  end if;

  perform public._drop_legacy_court_policies (p_table);

  execute format('alter table public.%I enable row level security', p_table);

  v_qual := format('public.auth_user_has_case(%I)', p_case_column);

  execute format(
    'create policy %I on public.%I for select to authenticated using (%s)',
    p_table || '_tenant_select',
    p_table,
    v_qual
  );

  execute format(
    'create policy %I on public.%I for insert to authenticated with check (%s)',
    p_table || '_tenant_insert',
    p_table,
    v_qual
  );

  execute format(
    'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
    p_table || '_tenant_update',
    p_table,
    v_qual,
    v_qual
  );

  execute format(
    'create policy %I on public.%I for delete to authenticated using (%s)',
    p_table || '_tenant_delete',
    p_table,
    v_qual
  );
end;
$$;

comment on function public.apply_case_rls_policies (name, name) is
  'Aplica políticas tenant vía auth_user_has_case(case_id).';

-- ---------------------------------------------------------------------------
-- Solo SELECT (auditoría, caché IA — escritura vía service_role)
-- ---------------------------------------------------------------------------

create or replace function public.apply_case_rls_select_only (
  p_table name,
  p_case_column name default 'case_id'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qual text;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    raise notice 'apply_case_rls_select_only: tabla public.% no existe — omitida', p_table;
    return;
  end if;

  perform public._drop_legacy_court_policies (p_table);

  execute format('alter table public.%I enable row level security', p_table);

  v_qual := format('public.auth_user_has_case(%I)', p_case_column);

  execute format(
    'create policy %I on public.%I for select to authenticated using (%s)',
    p_table || '_tenant_select',
    p_table,
    v_qual
  );
end;
$$;

comment on function public.apply_case_rls_select_only (name, name) is
  'Solo SELECT por tenant (tablas append-only o escritas por backend).';

-- =============================================================================
-- supabase/migrations/20260613160000_rls_apply_court_policies_all.sql
-- =============================================================================

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

-- FIN
