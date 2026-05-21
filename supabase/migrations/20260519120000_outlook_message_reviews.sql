-- Cola de correos judiciales pendientes de revisión humana antes de ingreso al expediente.

create table if not exists public.outlook_message_reviews (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  outlook_message_id text not null,
  parse_session_id text,
  subject text not null default '',
  from_address text,
  received_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'rejected', 'ingested')),
  classification jsonb not null default '{}'::jsonb,
  proposed_case_id uuid references public.cases (id) on delete set null,
  attachment_manifest jsonb not null default '[]'::jsonb,
  proposed_ingest jsonb not null default '[]'::jsonb,
  ingest_result jsonb,
  reject_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outlook_message_reviews_court_status_idx
  on public.outlook_message_reviews (court_id, status, created_at desc);

create unique index if not exists outlook_message_reviews_court_message_pending_uidx
  on public.outlook_message_reviews (court_id, outlook_message_id)
  where status = 'pending';

alter table public.outlook_message_reviews enable row level security;

comment on table public.outlook_message_reviews is
  'Correos Outlook analizados; ingreso al expediente solo tras aprobación del funcionario.';

create policy outlook_message_reviews_select_same_court on public.outlook_message_reviews
  for select to authenticated using (
    exists (
      select 1 from public.profiles v
      where v.id = auth.uid() and v.court_id = outlook_message_reviews.court_id
    )
  );

create policy outlook_message_reviews_insert_same_court on public.outlook_message_reviews
  for insert to authenticated with check (
    exists (
      select 1 from public.profiles v
      where v.id = auth.uid() and v.court_id = outlook_message_reviews.court_id
    )
  );

create policy outlook_message_reviews_update_same_court on public.outlook_message_reviews
  for update to authenticated using (
    exists (
      select 1 from public.profiles v
      where v.id = auth.uid() and v.court_id = outlook_message_reviews.court_id
    )
  ) with check (
    exists (
      select 1 from public.profiles v
      where v.id = auth.uid() and v.court_id = outlook_message_reviews.court_id
    )
  );
