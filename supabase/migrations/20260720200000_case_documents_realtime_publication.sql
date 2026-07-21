-- Expediente digital: INSERT/UPDATE/DELETE en case_documents deben llegar por Realtime
-- (CaseDetail ya se suscribe a case_id=eq.…; sin publicación el listado no refresca solo).

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array[
    'case_documents',
    'case_actions',
    'case_audit_log'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
