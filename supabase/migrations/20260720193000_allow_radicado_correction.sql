-- Permitir corregir radicado a roles de despacho (admin / clerk / judge),
-- manteniendo el bloqueo para el resto de usuarios autenticados.

create or replace function public.cases_guard_radicado_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if tg_op = 'UPDATE' then
    if old.radicado is not null
      and btrim(old.radicado) <> ''
      and new.radicado is distinct from old.radicado then
      if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
        return new;
      end if;

      if public.is_platform_admin() then
        return new;
      end if;

      select p.role into v_role
      from public.profiles p
      where p.id = auth.uid();

      if v_role in ('admin', 'clerk', 'judge')
        and public.auth_user_has_court(old.court_id) then
        return new;
      end if;

      raise exception 'El radicado no puede modificarse tras la radicación';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.cases_guard_radicado_immutable() is
  'Bloquea cambio de radicado salvo service_role, platform admin, o admin/clerk/judge del mismo despacho.';
