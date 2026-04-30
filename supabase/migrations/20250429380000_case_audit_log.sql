-- Historial técnico interno (despacho): registro automático de INSERT/UPDATE/DELETE en tablas del expediente.
-- Distinto de `case_actions` (actuaciones procesales relevantes). Solo consulta por funcionarios del mismo juzgado.

create table if not exists public.case_audit_log (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users (id) on delete set null,
  source_table text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  row_id text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists case_audit_log_case_time_idx
  on public.case_audit_log (case_id, occurred_at desc);

comment on table public.case_audit_log is
  'Trazabilidad técnica completa al expediente (quién tocó qué en BD). No es actuación judicial; ver case_actions.';

-- Recorta cadenas en el primer nivel del objeto JSON (evita filas gigantes por raw_text / content).
create or replace function public.audit_shrink_jsonb(j jsonb, max_len int default 4000)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  k text;
  v jsonb;
  out jsonb := '{}'::jsonb;
  s text;
begin
  if j is null then
    return '{}'::jsonb;
  end if;
  for k, v in select * from jsonb_each(j)
  loop
    if jsonb_typeof(v) = 'string' then
      s := v #>> '{}';
      if length(s) > max_len then
        out := out || jsonb_build_object(k, left(s, max_len) || '…[truncado]');
      else
        out := out || jsonb_build_object(k, v);
      end if;
    else
      out := out || jsonb_build_object(k, v);
    end if;
  end loop;
  return out;
end;
$$;

create or replace function public.case_audit_log_append(
  p_case_id uuid,
  p_source_table text,
  p_operation text,
  p_row_id text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_audit_log (case_id, actor_user_id, source_table, operation, row_id, payload)
  values (
    p_case_id,
    auth.uid(),
    p_source_table,
    p_operation,
    nullif(trim(coalesce(p_row_id, '')), ''),
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
create or replace function public.trg_audit_cases()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.cases), 4000);
    perform public.case_audit_log_append(old.id, 'cases', 'DELETE', old.id::text, jsonb_build_object('old', v_old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.cases), 4000);
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.cases), 4000);
    perform public.case_audit_log_append(new.id, 'cases', 'UPDATE', new.id::text, jsonb_build_object('old', v_old, 'new', v_new));
    return new;
  else
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.cases), 4000);
    perform public.case_audit_log_append(new.id, 'cases', 'INSERT', new.id::text, jsonb_build_object('new', v_new));
    return new;
  end if;
end;
$$;

drop trigger if exists cases_audit_trg on public.cases;
create trigger cases_audit_trg
  after insert or update or delete on public.cases
  for each row execute function public.trg_audit_cases();

-- ---------------------------------------------------------------------------
-- case_documents
-- ---------------------------------------------------------------------------
create or replace function public.trg_audit_case_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  cid uuid;
begin
  if tg_op = 'DELETE' then
    cid := old.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.case_documents), 4000);
    perform public.case_audit_log_append(cid, 'case_documents', 'DELETE', old.id::text, jsonb_build_object('old', v_old));
    return old;
  elsif tg_op = 'UPDATE' then
    cid := new.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.case_documents), 4000);
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.case_documents), 4000);
    perform public.case_audit_log_append(cid, 'case_documents', 'UPDATE', new.id::text, jsonb_build_object('old', v_old, 'new', v_new));
    return new;
  else
    cid := new.case_id;
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.case_documents), 4000);
    perform public.case_audit_log_append(cid, 'case_documents', 'INSERT', new.id::text, jsonb_build_object('new', v_new));
    return new;
  end if;
end;
$$;

drop trigger if exists case_documents_audit_trg on public.case_documents;
create trigger case_documents_audit_trg
  after insert or update or delete on public.case_documents
  for each row execute function public.trg_audit_case_documents();

-- ---------------------------------------------------------------------------
-- case_actions
-- ---------------------------------------------------------------------------
create or replace function public.trg_audit_case_actions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  cid uuid;
begin
  if tg_op = 'DELETE' then
    cid := old.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.case_actions), 4000);
    perform public.case_audit_log_append(cid, 'case_actions', 'DELETE', old.id::text, jsonb_build_object('old', v_old));
    return old;
  elsif tg_op = 'UPDATE' then
    cid := new.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.case_actions), 4000);
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.case_actions), 4000);
    perform public.case_audit_log_append(cid, 'case_actions', 'UPDATE', new.id::text, jsonb_build_object('old', v_old, 'new', v_new));
    return new;
  else
    cid := new.case_id;
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.case_actions), 4000);
    perform public.case_audit_log_append(cid, 'case_actions', 'INSERT', new.id::text, jsonb_build_object('new', v_new));
    return new;
  end if;
end;
$$;

drop trigger if exists case_actions_audit_trg on public.case_actions;
create trigger case_actions_audit_trg
  after insert or update or delete on public.case_actions
  for each row execute function public.trg_audit_case_actions();

-- ---------------------------------------------------------------------------
-- case_word_reviews (si la tabla existe en proyectos antiguos, el trigger se crea tras CREATE TABLE en migración previa)
-- ---------------------------------------------------------------------------
create or replace function public.trg_audit_case_word_reviews()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  cid uuid;
begin
  if tg_op = 'DELETE' then
    cid := old.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.case_word_reviews), 4000);
    perform public.case_audit_log_append(cid, 'case_word_reviews', 'DELETE', old.id::text, jsonb_build_object('old', v_old));
    return old;
  elsif tg_op = 'UPDATE' then
    cid := new.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.case_word_reviews), 4000);
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.case_word_reviews), 4000);
    perform public.case_audit_log_append(cid, 'case_word_reviews', 'UPDATE', new.id::text, jsonb_build_object('old', v_old, 'new', v_new));
    return new;
  else
    cid := new.case_id;
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.case_word_reviews), 4000);
    perform public.case_audit_log_append(cid, 'case_word_reviews', 'INSERT', new.id::text, jsonb_build_object('new', v_new));
    return new;
  end if;
end;
$$;

drop trigger if exists case_word_reviews_audit_trg on public.case_word_reviews;
create trigger case_word_reviews_audit_trg
  after insert or update or delete on public.case_word_reviews
  for each row execute function public.trg_audit_case_word_reviews();

-- ---------------------------------------------------------------------------
-- user_notifications (asignaciones, lecturas)
-- ---------------------------------------------------------------------------
create or replace function public.trg_audit_user_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  cid uuid;
begin
  if tg_op = 'DELETE' then
    cid := old.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.user_notifications), 4000);
    perform public.case_audit_log_append(cid, 'user_notifications', 'DELETE', old.id::text, jsonb_build_object('old', v_old));
    return old;
  elsif tg_op = 'UPDATE' then
    cid := new.case_id;
    v_old := public.audit_shrink_jsonb(to_jsonb(old::public.user_notifications), 4000);
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.user_notifications), 4000);
    perform public.case_audit_log_append(cid, 'user_notifications', 'UPDATE', new.id::text, jsonb_build_object('old', v_old, 'new', v_new));
    return new;
  else
    cid := new.case_id;
    v_new := public.audit_shrink_jsonb(to_jsonb(new::public.user_notifications), 4000);
    perform public.case_audit_log_append(cid, 'user_notifications', 'INSERT', new.id::text, jsonb_build_object('new', v_new));
    return new;
  end if;
end;
$$;

drop trigger if exists user_notifications_audit_trg on public.user_notifications;
create trigger user_notifications_audit_trg
  after insert or update or delete on public.user_notifications
  for each row execute function public.trg_audit_user_notifications();

-- ---------------------------------------------------------------------------
-- RLS: solo lectura; mismo court_id que el expediente (equipo del despacho).
-- ---------------------------------------------------------------------------
alter table public.case_audit_log enable row level security;

revoke all on public.case_audit_log from public;
grant select on public.case_audit_log to authenticated;

create policy case_audit_log_select_same_court
  on public.case_audit_log for select
  to authenticated
  using (
    exists (
      select 1
      from public.cases c
      inner join public.profiles p on p.id = auth.uid() and p.court_id = c.court_id
      where c.id = case_audit_log.case_id
    )
  );

-- Realtime (opcional): en Supabase → Publications → supabase_realtime, añada public.case_audit_log.
