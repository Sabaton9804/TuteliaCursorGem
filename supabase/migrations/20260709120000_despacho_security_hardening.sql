-- Endurecimiento seguridad despacho: perfiles, radicado inmutable, audit log, registro usuarios.

-- 1) Restringir columnas sensibles en profiles (solo service_role / triggers pueden mutar role, court_id, is_superuser)
create or replace function public.profiles_guard_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.role is distinct from old.role)
      or (new.court_id is distinct from old.court_id)
      or (new.is_superuser is distinct from old.is_superuser) then
      if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
        and not public.is_platform_admin() then
        raise exception 'No autorizado para modificar role, court_id o is_superuser del perfil';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_sensitive_columns on public.profiles;
create trigger profiles_guard_sensitive_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_sensitive_columns();

-- 2) Radicado inmutable tras radicación (no vacío)
create or replace function public.cases_guard_radicado_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.radicado is not null
      and btrim(old.radicado) <> ''
      and new.radicado is distinct from old.radicado then
      if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
        raise exception 'El radicado no puede modificarse tras la radicación';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cases_guard_radicado_immutable on public.cases;
create trigger cases_guard_radicado_immutable
  before update on public.cases
  for each row execute function public.cases_guard_radicado_immutable();

-- 3) case_actions append-only para usuarios app
drop policy if exists case_actions_tenant_delete on public.case_actions;
drop policy if exists case_actions_delete on public.case_actions;

-- 4) Nuevos usuarios: rol mínimo clerk, sin admin ni court fijo demo
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, court_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'usuario'), '@', 1)),
    'clerk',
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 5) CHECK role en profiles
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (
  role in (
    'admin', 'judge', 'clerk', 'official', 'sustanciador', 'escribiente', 'asistente_judicial'
  )
);
