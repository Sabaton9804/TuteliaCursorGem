-- Lista de equipo por despacho para la UI (evita depender solo de RLS en SELECT masivo de profiles).
-- La función toma el court_id SOLO del perfil del usuario autenticado; no expone otros juzgados.

create or replace function public.court_team_members ()
returns setof public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select p.*
  from public.profiles p
  where p.court_id = (
    select pr.court_id
    from public.profiles pr
    where pr.id = auth.uid()
    limit 1
  )
  order by p.name asc;
$$;

revoke all on function public.court_team_members () from public;
grant execute on function public.court_team_members () to authenticated;
