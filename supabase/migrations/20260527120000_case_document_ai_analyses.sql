-- Análisis IA por pieza (lectura rápida asistida) + hash de archivo para invalidación de caché.

alter table public.case_documents
  add column if not exists file_hash text;

comment on column public.case_documents.file_hash is
  'SHA-256 hex del binario en Storage; se actualiza al analizar o reemplazar la pieza.';

create table if not exists public.case_document_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  case_document_id uuid not null references public.case_documents (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  content_hash text not null,
  page_count_sent int not null default 0,
  token_estimate int,
  model text not null default 'gpt-4o-mini',
  prompt_version text not null default 'v1.0',
  analysis_data jsonb not null,
  summary_markdown text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists case_document_ai_analyses_doc_uidx
  on public.case_document_ai_analyses (case_document_id);

create index if not exists case_document_ai_analyses_case_idx
  on public.case_document_ai_analyses (case_id, created_at desc);

comment on table public.case_document_ai_analyses is
  'Caché de lectura rápida asistida por IA de una pieza del expediente digital.';

-- case_id debe coincidir con el documento referenciado
create or replace function public.case_document_ai_analyses_check_case()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.case_documents d
    where d.id = new.case_document_id
      and d.case_id = new.case_id
  ) then
    raise exception 'case_id no coincide con case_document_id';
  end if;
  return new;
end;
$$;

drop trigger if exists case_document_ai_analyses_check_case_trg on public.case_document_ai_analyses;
create trigger case_document_ai_analyses_check_case_trg
  before insert or update on public.case_document_ai_analyses
  for each row
  execute function public.case_document_ai_analyses_check_case();

alter table public.case_document_ai_analyses enable row level security;

create policy case_document_ai_analyses_select_same_court
  on public.case_document_ai_analyses
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.cases c
      inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
      where c.id = case_document_ai_analyses.case_id
    )
  );

create policy case_document_ai_analyses_select_superuser
  on public.case_document_ai_analyses
  for select
  to authenticated
  using (public.auth_is_superuser ());

-- Escritura vía service_role en server.ts (sin policy INSERT/UPDATE para authenticated).
