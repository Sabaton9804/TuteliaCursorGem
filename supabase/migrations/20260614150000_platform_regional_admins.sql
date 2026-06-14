-- Fase F: administradores regionales de plataforma (delegación por territorio).
-- depends on: 20260613120000_platform_admins.sql
-- depends on: 20260529120000_judicial_process_platform_phase1.sql (judicial_territories)

-- ---------------------------------------------------------------------------
-- platform_regional_admins — alcance territorial en consola /plataforma
-- ---------------------------------------------------------------------------

create table if not exists public.platform_regional_admins (
  user_id uuid not null references auth.users (id) on delete cascade,
  territory_id uuid not null references public.judicial_territories (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  notes text,
  primary key (user_id, territory_id)
);

comment on table public.platform_regional_admins is
  'Operadores regionales: consola /plataforma limitada a despachos del territorio.';

create index if not exists platform_regional_admins_territory_idx
  on public.platform_regional_admins (territory_id);

alter table public.platform_regional_admins
  drop constraint if exists platform_regional_admins_profile_fkey;

alter table public.platform_regional_admins
  add constraint platform_regional_admins_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Helpers de alcance regional
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_regional_admin ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_regional_admins pra
    where pra.user_id = auth.uid ()
  );
$$;

comment on function public.is_platform_regional_admin () is
  'True si el usuario tiene al menos un territorio asignado en platform_regional_admins.';

create or replace function public.has_platform_console_access ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin ()
    or public.is_platform_regional_admin ();
$$;

comment on function public.has_platform_console_access () is
  'Acceso a /plataforma: admin nacional o regional.';

create or replace function public.platform_regional_territory_ids ()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(pra.territory_id order by pra.territory_id),
    '{}'::uuid[]
  )
  from public.platform_regional_admins pra
  where pra.user_id = auth.uid ();
$$;

comment on function public.platform_regional_territory_ids () is
  'Territorios asignados al usuario regional (vacío si no es regional).';

create or replace function public.platform_regional_can_view_court (p_court_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.courts c
    inner join public.platform_regional_admins pra
      on pra.territory_id = c.territory_id
    where c.id = p_court_id
      and pra.user_id = auth.uid ()
      and c.territory_id is not null
  );
$$;

comment on function public.platform_regional_can_view_court (text) is
  'Consola plataforma: regional admin puede listar/ver despachos de su territorio.';

create or replace function public.platform_can_manage_territory (p_territory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin ()
    or (
      p_territory_id is not null
      and exists (
        select 1
        from public.platform_regional_admins pra
        where pra.user_id = auth.uid ()
          and pra.territory_id = p_territory_id
      )
    );
$$;

comment on function public.platform_can_manage_territory (uuid) is
  'Crear/editar despachos o importar CSV en un territorio.';

create or replace function public.platform_can_manage_court (p_court_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin ()
    or exists (
      select 1
      from public.courts c
      inner join public.platform_regional_admins pra
        on pra.territory_id = c.territory_id
      where c.id = p_court_id
        and pra.user_id = auth.uid ()
        and c.territory_id is not null
    );
$$;

comment on function public.platform_can_manage_court (text) is
  'Invitar usuarios o operar un despacho desde consola (alcance regional).';

-- ---------------------------------------------------------------------------
-- RLS platform_regional_admins
-- ---------------------------------------------------------------------------

alter table public.platform_regional_admins enable row level security;

drop policy if exists platform_regional_admins_select on public.platform_regional_admins;
create policy platform_regional_admins_select on public.platform_regional_admins
  for select to authenticated
  using (
    public.is_platform_admin ()
    or user_id = auth.uid ()
  );

drop policy if exists platform_regional_admins_insert on public.platform_regional_admins;
create policy platform_regional_admins_insert on public.platform_regional_admins
  for insert to authenticated
  with check (public.is_platform_admin ());

drop policy if exists platform_regional_admins_delete on public.platform_regional_admins;
create policy platform_regional_admins_delete on public.platform_regional_admins
  for delete to authenticated
  using (public.is_platform_admin ());

-- ---------------------------------------------------------------------------
-- courts SELECT — regional admin ve despachos de su territorio (solo consola)
-- ---------------------------------------------------------------------------

drop policy if exists courts_tenant_select on public.courts;

create policy courts_tenant_select on public.courts
  for select to authenticated
  using (
    public.auth_user_has_court (id)
    or public.platform_regional_can_view_court (id)
  );

-- ---------------------------------------------------------------------------
-- platform_audit_log — regional ve auditoría de su territorio
-- ---------------------------------------------------------------------------

drop policy if exists platform_audit_log_select_admin on public.platform_audit_log;

create policy platform_audit_log_select_admin on public.platform_audit_log
  for select to authenticated
  using (
    public.is_platform_admin ()
    or (
      target_court_id is not null
      and public.platform_regional_can_view_court (target_court_id)
    )
    or (
      target_court_id is null
      and metadata ? 'territory_id'
      and public.platform_can_manage_territory ((metadata ->> 'territory_id')::uuid)
    )
  );

-- ---------------------------------------------------------------------------
-- bulk import — regional admin + chequeo por fila (reemplaza trusted caller)
-- ---------------------------------------------------------------------------

create or replace function public.bulk_import_is_trusted_caller ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin ()
    or public.is_platform_regional_admin ()
    or coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
      ''
    ) = 'service_role'
    or session_user in ('postgres', 'supabase_admin');
$$;

create or replace function public.bulk_upsert_courts (p_rows jsonb)
returns table (
  row_num int,
  court_id text,
  action text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_idx int := 0;
  v_name text;
  v_id text;
  v_official_name text;
  v_email text;
  v_city text;
  v_status text;
  v_dane text;
  v_entity text;
  v_spec text;
  v_num text;
  v_cui12 text;
  v_territory_id uuid;
  v_specialty_id uuid;
  v_category_id uuid;
  v_specialty_code text;
  v_entity_category text;
  v_existing_id text;
  v_final_id text;
begin
  if not public.bulk_import_is_trusted_caller () then
    raise exception 'Sin permiso para importar despachos';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows debe ser un array JSON';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;
    row_num := v_idx;
    court_id := null;
    action := 'error';
    message := null;
    v_final_id := null;

    begin
      v_name := nullif(trim(v_row ->> 'name'), '');
      v_id := nullif(trim(v_row ->> 'id'), '');
      v_official_name := nullif(trim(v_row ->> 'official_name'), '');
      v_email := coalesce(nullif(trim(v_row ->> 'email'), ''), '');
      v_city := coalesce(nullif(trim(v_row ->> 'city'), ''), '');
      v_status := lower(coalesce(nullif(trim(v_row ->> 'status'), ''), 'active'));
      v_dane := nullif(trim(v_row ->> 'dane_code'), '');
      v_entity := nullif(trim(v_row ->> 'entity_code'), '');
      v_spec := nullif(trim(v_row ->> 'specialty_code'), '');
      v_num := nullif(trim(v_row ->> 'despacho_number'), '');
      v_cui12 := regexp_replace(coalesce(v_row ->> 'cui_12', ''), '\D', '', 'g');
      v_specialty_code := nullif(lower(trim(v_row ->> 'specialty')), '');
      v_entity_category := nullif(lower(trim(v_row ->> 'entity_category')), '');

      if v_name is null then
        action := 'error';
        message := 'name es requerido';
        return next;
        continue;
      end if;

      if length(v_cui12) = 12 then
        v_dane := substring(v_cui12 from 1 for 5);
        v_entity := substring(v_cui12 from 6 for 2);
        v_spec := substring(v_cui12 from 8 for 2);
        v_num := substring(v_cui12 from 10 for 3);
      end if;

      if v_dane is null or v_entity is null or v_spec is null or v_num is null then
        action := 'error';
        message := 'CUI incompleto: use cui_12 o dane_code+entity_code+specialty_code+despacho_number';
        return next;
        continue;
      end if;

      v_num := lpad(regexp_replace(v_num, '\D', '', 'g'), 3, '0');
      v_dane := lpad(regexp_replace(v_dane, '\D', '', 'g'), 5, '0');

      if v_status not in ('active', 'inactive', 'suspended') then
        action := 'error';
        message := format('status inválido: %s', v_status);
        return next;
        continue;
      end if;

      select jt.id into v_territory_id
      from public.judicial_territories jt
      where jt.dane_code = v_dane
      limit 1;

      if not public.is_platform_admin ()
        and auth.uid () is not null
        and not public.platform_can_manage_territory (v_territory_id) then
        action := 'error';
        message := 'Sin permiso regional para el territorio del CUI';
        return next;
        continue;
      end if;

      if v_specialty_code is not null then
        select js.id into v_specialty_id
        from public.judicial_specialties js
        where js.code = v_specialty_code
        limit 1;
        if v_specialty_id is null then
          action := 'error';
          message := format('specialty desconocida: %s', v_specialty_code);
          return next;
          continue;
        end if;
      end if;

      if v_entity_category is not null then
        select jec.id into v_category_id
        from public.judicial_entity_categories jec
        where jec.code = v_entity_category
        limit 1;
        if v_category_id is null then
          action := 'error';
          message := format('entity_category desconocida: %s', v_entity_category);
          return next;
          continue;
        end if;
      end if;

      v_existing_id := null;
      if v_id is not null then
        select c.id into v_existing_id from public.courts c where c.id = v_id limit 1;
      end if;

      if v_existing_id is null then
        select c.id into v_existing_id
        from public.courts c
        where c.dane_code = v_dane
          and c.entity_code = v_entity
          and c.specialty_code = v_spec
          and c.despacho_number = v_num
        limit 1;
      end if;

      if v_id is not null and v_existing_id is not null and v_id <> v_existing_id then
        action := 'error';
        message := format(
          'CUI ya registrado como %s; id CSV %s no coincide',
          v_existing_id,
          v_id
        );
        return next;
        continue;
      end if;

      v_final_id := coalesce(v_existing_id, v_id, 'court-' || v_num);

      if v_city = '' and v_territory_id is not null then
        select jt.name into v_city
        from public.judicial_territories jt
        where jt.id = v_territory_id;
        v_city := coalesce(v_city, '');
      end if;

      insert into public.courts (
        id,
        name,
        email,
        city,
        status,
        official_name,
        dane_code,
        entity_code,
        specialty_code,
        despacho_number,
        territory_id,
        judicial_specialty_id,
        entity_category_id,
        updated_at
      )
      values (
        v_final_id,
        v_name,
        v_email,
        v_city,
        v_status,
        v_official_name,
        v_dane,
        v_entity,
        v_spec,
        v_num,
        v_territory_id,
        v_specialty_id,
        v_category_id,
        now()
      )
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        city = excluded.city,
        status = excluded.status,
        official_name = coalesce(excluded.official_name, public.courts.official_name),
        dane_code = excluded.dane_code,
        entity_code = excluded.entity_code,
        specialty_code = excluded.specialty_code,
        despacho_number = excluded.despacho_number,
        territory_id = coalesce(excluded.territory_id, public.courts.territory_id),
        judicial_specialty_id = coalesce(excluded.judicial_specialty_id, public.courts.judicial_specialty_id),
        entity_category_id = coalesce(excluded.entity_category_id, public.courts.entity_category_id),
        updated_at = now();

      court_id := v_final_id;
      if v_existing_id is null then
        action := 'inserted';
        message := public.court_cui_official_code(v_final_id);
      else
        action := 'updated';
        message := public.court_cui_official_code(v_final_id);
      end if;
      return next;

    exception
      when others then
        court_id := v_final_id;
        action := 'error';
        message := sqlerrm;
        return next;
    end;
  end loop;

  return;
end;
$$;
