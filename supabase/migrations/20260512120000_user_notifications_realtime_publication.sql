-- Publicar user_notifications en supabase_realtime para que la campana actualice sin recargar.
-- Idempotente: no falla si la tabla ya está en la publicación.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'user_notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.user_notifications';
  end if;
end
$$;
