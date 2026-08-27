-- Las macros RLS son SECURITY DEFINER en public. Postgres concede EXECUTE a PUBLIC
-- por defecto: cualquier JWT authenticated podía borrar/recrear políticas.
-- Quedan solo para postgres / service_role (migraciones y scripts admin).

revoke all on function public._drop_legacy_court_policies (name) from public;
revoke all on function public.apply_court_rls_policies (name, name) from public;
revoke all on function public.apply_case_rls_policies (name, name) from public;
revoke all on function public.apply_case_rls_select_only (name, name) from public;

revoke all on function public._drop_legacy_court_policies (name) from anon, authenticated;
revoke all on function public.apply_court_rls_policies (name, name) from anon, authenticated;
revoke all on function public.apply_case_rls_policies (name, name) from anon, authenticated;
revoke all on function public.apply_case_rls_select_only (name, name) from anon, authenticated;

grant execute on function public._drop_legacy_court_policies (name) to postgres, service_role;
grant execute on function public.apply_court_rls_policies (name, name) to postgres, service_role;
grant execute on function public.apply_case_rls_policies (name, name) to postgres, service_role;
grant execute on function public.apply_case_rls_select_only (name, name) to postgres, service_role;

comment on function public._drop_legacy_court_policies (name) is
  'Helper interno (solo postgres/service_role): quita políticas RLS legacy antes de apply_*_rls_policies.';
