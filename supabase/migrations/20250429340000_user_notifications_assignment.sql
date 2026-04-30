-- Avisos in-app cuando se asigna un expediente a un sustanciador (perfil del mismo juzgado).

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'case_assigned_sustanciador',
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists user_notifications_recipient_created_idx
  on public.user_notifications (recipient_user_id, created_at desc);

create index if not exists user_notifications_recipient_unread_idx
  on public.user_notifications (recipient_user_id)
  where read_at is null;

alter table public.user_notifications enable row level security;

create policy user_notifications_select_own
  on public.user_notifications for select
  to authenticated
  using (recipient_user_id = auth.uid());

create policy user_notifications_update_own
  on public.user_notifications for update
  to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- Solo perfiles del mismo despacho que el que inserta; el expediente debe pertenecer al court_id indicado.
create policy user_notifications_insert_same_court
  on public.user_notifications for insert
  to authenticated
  with check (
    exists (select 1 from public.cases c where c.id = case_id and c.court_id = court_id)
    and exists (
      select 1
      from public.profiles p
      inner join public.profiles v on v.id = auth.uid() and v.court_id = p.court_id
      where p.id = recipient_user_id
    )
  );

comment on table public.user_notifications is
  'Notificaciones in-app; p. ej. asignación de sustanciador. Trazabilidad complementaria a case_actions.';
