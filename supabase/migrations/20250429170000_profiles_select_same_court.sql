-- Permitir que cada funcionario vea los perfiles del mismo despacho (equipo de trabajo).
-- Las políticas SELECT permisivas se combinan con OR respecto a profiles_select_own.

create policy profiles_select_same_court
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles viewer
      where viewer.id = auth.uid()
        and viewer.court_id = profiles.court_id
    )
  );
