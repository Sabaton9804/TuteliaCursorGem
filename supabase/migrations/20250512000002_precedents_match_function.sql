-- Búsqueda semántica de precedentes (pgvector). Requiere extensión vector (migración 20250512000001).

create or replace function public.match_precedents(
  query_embedding extensions.vector(1536),
  match_court_id text,
  match_count int default 3,
  match_threshold double precision default 0.7
)
returns table (
  id uuid,
  source_case_id uuid,
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
    p.id,
    p.source_case_id,
    p.radicado,
    p.right_protected,
    p.defendant,
    p.ruling_sense,
    p.summary,
    p.legal_arguments,
    p.source_excerpt,
    p.decision_date,
    p.tags,
    (1 - (p.embedding <=> query_embedding))::double precision as similarity
  from public.precedents p
  where p.court_id = match_court_id
    and p.embedding is not null
    and (1 - (p.embedding <=> query_embedding)) > match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_precedents is 'Vecinos más cercanos por coseno (1 - distancia); filtra por despacho y umbral de similitud.';

grant execute on function public.match_precedents(
  extensions.vector,
  text,
  int,
  double precision
) to anon, authenticated, service_role;
