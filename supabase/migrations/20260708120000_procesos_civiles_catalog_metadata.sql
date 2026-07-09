-- Procesos civiles + metadatos de catálogo (importación plataforma J51).
-- Amplía process_definitions, relaja CHECK de case_type y añade cases.catalog_metadata.

-- ---------------------------------------------------------------------------
-- cases.catalog_metadata
-- ---------------------------------------------------------------------------

alter table public.cases
  add column if not exists catalog_metadata jsonb not null default '{}'::jsonb;

comment on column public.cases.catalog_metadata is
  'Metadatos del catálogo operativo (ubicacion_interna, regimen, confianza_estado, tipo_proceso, subserie_sgde, fuente_estado, ultimo_auto_*, etc.).';

create index if not exists cases_catalog_metadata_gin_idx
  on public.cases using gin (catalog_metadata);

-- ---------------------------------------------------------------------------
-- Relajar CHECK cases.case_type (incluir civiles)
-- ---------------------------------------------------------------------------

alter table public.cases drop constraint if exists cases_case_type_check;

alter table public.cases
  add constraint cases_case_type_check check (
    case_type in (
      'tutela_primera',
      'tutela_segunda',
      'consulta_desacato',
      'civil_ordinario',
      'civil_ejecutivo',
      'civil_jurisdiccion_voluntaria',
      'civil_insolvencia',
      'civil_otros'
    )
  );

-- ---------------------------------------------------------------------------
-- Relajar CHECK process_definitions.legacy_case_type
-- ---------------------------------------------------------------------------

alter table public.process_definitions drop constraint if exists process_definitions_legacy_case_type_check;

alter table public.process_definitions
  add constraint process_definitions_legacy_case_type_check check (
    legacy_case_type is null
    or legacy_case_type in (
      'tutela_primera',
      'tutela_segunda',
      'consulta_desacato',
      'civil_ordinario',
      'civil_ejecutivo',
      'civil_jurisdiccion_voluntaria',
      'civil_insolvencia',
      'civil_otros'
    )
  );

-- ---------------------------------------------------------------------------
-- Seed: process_definitions civiles
-- ---------------------------------------------------------------------------

insert into public.process_definitions (
  code,
  label,
  process_domain,
  instance_level,
  specialty_id,
  entity_category_id,
  case_term_days,
  case_term_type,
  legacy_case_type,
  description
)
select
  v.code,
  v.label,
  'civil',
  1::smallint,
  (select id from public.judicial_specialties where code = 'civil'),
  (select id from public.judicial_entity_categories where code = 'circuito'),
  null::int,
  'none',
  v.legacy_case_type,
  v.description
from (
  values
    (
      'civil_ordinario'::text,
      'Proceso civil ordinario'::text,
      'civil_ordinario'::text,
      'Demanda, admisión, contestación y trámite ordinario (CGP).'::text
    ),
    (
      'civil_ejecutivo',
      'Proceso ejecutivo',
      'civil_ejecutivo',
      'Ejecutivo singular, ejecutivo con garantía real y cobro judicial.'
    ),
    (
      'civil_jurisdiccion_voluntaria',
      'Jurisdicción voluntaria',
      'civil_jurisdiccion_voluntaria',
      'Trámites de jurisdicción voluntaria civil.'
    ),
    (
      'civil_insolvencia',
      'Insolvencia persona natural',
      'civil_insolvencia',
      'Insolvencia de la persona natural.'
    ),
    (
      'civil_otros',
      'Otros procesos civiles',
      'civil_otros',
      'Procesos civiles no clasificados en ordinario/ejecutivo.'
    )
) as v (code, label, legacy_case_type, description)
on conflict (code) do update set
  label = excluded.label,
  process_domain = excluded.process_domain,
  instance_level = excluded.instance_level,
  specialty_id = excluded.specialty_id,
  entity_category_id = excluded.entity_category_id,
  case_term_days = excluded.case_term_days,
  case_term_type = excluded.case_term_type,
  legacy_case_type = excluded.legacy_case_type,
  description = excluded.description;

-- Etapas mínimas civiles (carril lineal secretaría/despacho)
create or replace function public._seed_civil_process_stages (p_process_code text)
returns void
language plpgsql
as $$
declare
  v_pid uuid;
begin
  select id into v_pid from public.process_definitions where code = p_process_code;
  if v_pid is null then
    raise exception 'process_definitions % no existe', p_process_code;
  end if;

  delete from public.process_stages_definition where process_definition_id = v_pid;

  insert into public.process_stages_definition (
    process_definition_id, code, label, order_index, stage_kind,
    term_days, term_type, responsible_role, generates_alert, alert_threshold_pct
  )
  values
    (v_pid, 'RADICACION', 'Radicación', 1, 'linear', null, 'none', 'secretaria', false, 75),
    (v_pid, 'ADMISION', 'Admisión', 2, 'linear', null, 'none', 'despacho', false, 75),
    (v_pid, 'TRAMITE', 'Trámite', 3, 'linear', null, 'none', 'despacho', false, 75),
    (v_pid, 'FALLO', 'Fallo / auto definitivo', 4, 'linear', null, 'none', 'despacho', false, 75),
    (v_pid, 'EJECUTORIA', 'Ejecutoria / archivo', 5, 'terminal', null, 'none', 'despacho', false, 75);
end;
$$;

select public._seed_civil_process_stages('civil_ordinario');
select public._seed_civil_process_stages('civil_ejecutivo');
select public._seed_civil_process_stages('civil_jurisdiccion_voluntaria');
select public._seed_civil_process_stages('civil_insolvencia');
select public._seed_civil_process_stages('civil_otros');

drop function if exists public._seed_civil_process_stages (text);

-- Habilitar civiles en despacho demo J51
insert into public.court_enabled_processes (court_id, process_definition_id)
select 'court-1', pd.id
from public.process_definitions pd
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict do nothing;
