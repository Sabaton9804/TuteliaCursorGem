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
