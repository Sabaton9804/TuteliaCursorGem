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
