-- Fragmentos vectoriales por precedente (búsqueda semántica sobre fallos largos).

alter table public.precedents
  add column if not exists source_storage_path text null;

comment on column public.precedents.source_storage_path is 'Ruta opcional en Storage del documento fuente (PDF/DOCX) para enlace de descarga.';

create table if not exists public.precedent_chunks (
  id uuid primary key default gen_random_uuid(),
  precedent_id uuid not null references public.precedents (id) on delete cascade,
  court_id text not null references public.courts (id) on delete restrict,
  chunk_index int not null,
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  embedding extensions.vector (1536),
  created_at timestamptz not null default now(),
  unique (precedent_id, chunk_index)
);

create index if not exists precedent_chunks_precedent_idx on public.precedent_chunks (precedent_id);
create index if not exists precedent_chunks_court_idx on public.precedent_chunks (court_id);

create index if not exists precedent_chunks_embedding_hnsw_idx
  on public.precedent_chunks
  using hnsw (embedding vector_cosine_ops);

comment on table public.precedent_chunks is 'Texto fragmentado y vectorizado para RAG sobre precedentes largos.';
comment on column public.precedent_chunks.meta is 'Metadatos: p. ej. char_start, char_end en documento canónico, version del chunker.';

create or replace function public.enforce_precedent_chunks_court ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court text;
begin
  select p.court_id into v_court from public.precedents p where p.id = NEW.precedent_id;
  if v_court is null then
    raise exception 'precedent_chunks: precedent_id % no existe', NEW.precedent_id;
  end if;
  NEW.court_id := v_court;
  return NEW;
end;
$$;

drop trigger if exists precedent_chunks_court_trg on public.precedent_chunks;
create trigger precedent_chunks_court_trg
  before insert or update on public.precedent_chunks
  for each row execute function public.enforce_precedent_chunks_court ();

-- Búsqueda por similitud coseno sobre fragmentos; el agregado por precedente padre lo hace el backend.
drop function if exists public.match_precedent_chunks(extensions.vector, text, integer, double precision);
drop function if exists public.match_precedent_chunks(vector, text, integer, double precision);

create or replace function public.match_precedent_chunks (
  query_embedding extensions.vector(1536),
  match_court_id text,
  match_count int default 48,
  match_threshold double precision default 0.25
)
returns table (
  chunk_id uuid,
  precedent_id uuid,
  chunk_index int,
  chunk_content text,
  chunk_meta jsonb,
  source_case_id uuid,
  source_type text,
  source_corporation text,
  radicado text,
  right_protected text,
  defendant text,
  ruling_sense text,
  summary text,
  legal_arguments text,
  source_excerpt text,
  decision_date date,
  tags jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.precedent_id,
    c.chunk_index,
    c.content as chunk_content,
    c.meta as chunk_meta,
    p.source_case_id,
    p.source_type,
    p.source_corporation,
    p.radicado,
    p.right_protected,
    p.defendant,
    p.ruling_sense,
    p.summary,
    p.legal_arguments,
    p.source_excerpt,
    p.decision_date,
    p.tags,
    (1 - (c.embedding <=> query_embedding))::double precision as similarity
  from public.precedent_chunks c
  inner join public.precedents p on p.id = c.precedent_id
  where c.court_id = match_court_id
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_precedent_chunks is
  'Vecinos por coseno a nivel de fragmento; join con precedents para respuesta enriquecida.';

grant execute on function public.match_precedent_chunks(
  extensions.vector,
  text,
  int,
  double precision
) to anon, authenticated, service_role;

alter table public.precedent_chunks enable row level security;

create policy precedent_chunks_select_same_court on public.precedent_chunks for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedent_chunks.court_id)
);
create policy precedent_chunks_insert_same_court on public.precedent_chunks for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedent_chunks.court_id)
);
create policy precedent_chunks_update_same_court on public.precedent_chunks for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedent_chunks.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedent_chunks.court_id)
);
create policy precedent_chunks_delete_same_court on public.precedent_chunks for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedent_chunks.court_id)
);
