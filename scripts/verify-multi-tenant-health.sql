-- Verificación multi-tenant Tutelia (Fase A).
-- Uso: psql $DATABASE_URL -v ON_ERROR_STOP=1 -f scripts/verify-multi-tenant-health.sql
--      npm run verify:multi-tenant (si DATABASE_URL está configurada)

\set ON_ERROR_STOP on

do $$
declare
  v_missing int;
  v_table text;
  v_tables text[] := array[
    'cases',
    'case_documents',
    'precedents',
    'document_templates',
    'workflow_tasks',
    'user_notifications',
    'court_mailboxes',
    'profile_court_memberships'
  ];
begin
  -- 1) Helpers obligatorios
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception 'VERIFY FAIL: falta función is_platform_admin()';
  end if;

  if to_regprocedure('public.auth_user_has_court(text)') is null then
    raise exception 'VERIFY FAIL: falta función auth_user_has_court(text)';
  end if;

  if to_regprocedure('public.current_court_id()') is null then
    raise exception 'VERIFY FAIL: falta función current_court_id()';
  end if;

  if to_regprocedure('public.auth_user_has_case(uuid)') is null then
    raise exception 'VERIFY FAIL: falta función auth_user_has_case(uuid)';
  end if;

  raise notice 'OK: helpers RLS presentes';

  -- 2) Tablas platform
  if to_regclass('public.platform_admins') is null then
    raise exception 'VERIFY FAIL: falta tabla platform_admins';
  end if;

  if to_regclass('public.platform_audit_log') is null then
    raise exception 'VERIFY FAIL: falta tabla platform_audit_log';
  end if;

  raise notice 'OK: tablas platform_admins y platform_audit_log';

  -- 3) courts.status
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'courts'
      and column_name = 'status'
  ) then
    raise exception 'VERIFY FAIL: courts.status no existe';
  end if;

  raise notice 'OK: courts.status existe';

  -- 4) pg_trgm en courts
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'courts'
      and indexname = 'courts_name_trgm_idx'
  ) then
    raise exception 'VERIFY FAIL: índice courts_name_trgm_idx no existe';
  end if;

  raise notice 'OK: índice trgm en courts.name';

  -- 5) RLS enabled en tablas operativas muestra
  foreach v_table in array v_tables
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and c.relrowsecurity = true
    ) then
      raise exception 'VERIFY FAIL: RLS no habilitado en public.%', v_table;
    end if;
  end loop;

  raise notice 'OK: RLS habilitado en tablas operativas muestra';

  -- 6) Políticas USING (true) en tablas con court_id (no catálogo)
  select count(*) into v_missing
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = any (v_tables)
    and (
      pol.qual = 'true'
      or pol.with_check = 'true'
    );

  if v_missing > 0 then
    raise exception 'VERIFY FAIL: % políticas USING/WITH CHECK (true) en tablas operativas', v_missing;
  end if;

  raise notice 'OK: sin políticas USING (true) en muestra operativa';

  -- 7) Políticas tenant unificadas (Fase B)
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cases'
      and policyname = 'cases_tenant_select'
  ) then
    raise exception 'VERIFY FAIL: falta política cases_tenant_select (Fase B no aplicada)';
  end if;

  if not exists (
    select 1
    from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'cases'
      and pol.qual like '%auth_user_has_court%'
  ) then
    raise exception 'VERIFY FAIL: cases no usa auth_user_has_court en RLS';
  end if;

  raise notice 'OK: RLS unificado Fase B (cases_tenant_select)';

  -- 8) platform_admins — warning si vacío (dev seed pendiente)
  if (select count(*) from public.platform_admins) = 0 then
    raise warning 'WARN: platform_admins vacío — ejecute seed:superuser o asigne is_superuser';
  else
    raise notice 'OK: platform_admins tiene % fila(s)', (select count(*) from public.platform_admins);
  end if;

  raise notice 'VERIFY PASS: multi-tenant health Fase A';
end;
$$;
