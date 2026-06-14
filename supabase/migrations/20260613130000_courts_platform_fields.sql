-- Fase A evolutiva (2/3): campos consola platform + búsqueda trgm en courts.
-- depends on: 20260529120000_judicial_process_platform_phase1.sql (territory_id, judicial_specialty_id)
-- depends on: 20250428120000_tutelia_core.sql (courts)

-- ---------------------------------------------------------------------------
-- Estado operativo del despacho (consola /plataforma)
-- ---------------------------------------------------------------------------

alter table public.courts
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  add column if not exists official_name text;

comment on column public.courts.status is
  'Estado en consola platform: active | inactive | suspended.';
comment on column public.courts.official_name is
  'Nombre oficial TYBA/Rama si difiere del name corto en UI.';

create index if not exists courts_status_idx on public.courts (status);

create index if not exists courts_platform_filter_idx
  on public.courts (status, territory_id, judicial_specialty_id, entity_category_id);

-- ---------------------------------------------------------------------------
-- Código CUI despacho (12 dígitos: DANE + entidad + especialidad + número)
-- ---------------------------------------------------------------------------

create or replace function public.court_cui_official_code (p_court_id text)
returns text
language sql
stable
set search_path = public
as $$
  select
    coalesce(nullif(trim(c.dane_code), ''), '')
    || coalesce(nullif(trim(c.entity_code), ''), '')
    || coalesce(nullif(trim(c.specialty_code), ''), '')
    || coalesce(nullif(trim(c.despacho_number), ''), '')
  from public.courts c
  where c.id = p_court_id;
$$;

comment on function public.court_cui_official_code (text) is
  'CUI despacho sin año (12 chars). Upsert en bulk import por este valor compuesto.';

-- ---------------------------------------------------------------------------
-- Búsqueda pg_trgm (5000+ despachos en consola)
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm;

create index if not exists courts_name_trgm_idx
  on public.courts using gin (name gin_trgm_ops);

create index if not exists courts_official_name_trgm_idx
  on public.courts using gin (official_name gin_trgm_ops)
  where official_name is not null;

create index if not exists courts_id_trgm_idx
  on public.courts using gin (id gin_trgm_ops);

-- Expresión indexable para búsqueda por CUI parcial (consola Fase C)
create index if not exists courts_cui_expr_trgm_idx
  on public.courts using gin (
    (
      coalesce(dane_code, '')
      || coalesce(entity_code, '')
      || coalesce(specialty_code, '')
      || coalesce(despacho_number, '')
    ) gin_trgm_ops
  )
  where dane_code is not null;
