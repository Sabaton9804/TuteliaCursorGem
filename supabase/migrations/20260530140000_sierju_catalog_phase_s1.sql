-- Fase SIERJU S1: catalogo formularios, secciones, clases y movimientos.
-- Seed: supabase/seed/sierju_catalog_seed.sql (regenerar con scripts/sierju/generate-sierju-seed-sql.mts)
-- Docs: docs/sierju-estadistica-integracion.md

-- ---------------------------------------------------------------------------
-- Catalogo SIERJU
-- ---------------------------------------------------------------------------

create table if not exists public.sierju_form_templates (
  code text primary key,
  label text not null,
  version text not null default '',
  effective_from date,
  source_document text,
  created_at timestamptz not null default now()
);

comment on table public.sierju_form_templates is
  'Variante de formulario SIERJU por tipo de despacho (civil circuito, restitucion tierras, etc.).';

create table if not exists public.sierju_sections (
  id uuid primary key default gen_random_uuid(),
  form_template_code text not null references public.sierju_form_templates (code) on delete cascade,
  code text not null,
  label text not null,
  specialty text not null default 'transversal'
    check (
      specialty in (
        'civil',
        'laboral',
        'familia',
        'constitucional',
        'tierras',
        'transversal'
      )
    ),
  instance_level smallint check (instance_level is null or instance_level between 1 and 3),
  procedure_mode text check (procedure_mode is null or procedure_mode in ('escrito', 'oral')),
  unit_of_measure text not null default 'proceso'
    check (
      unit_of_measure in (
        'proceso',
        'tutela',
        'incidente',
        'impugnacion',
        'consulta',
        'actuacion',
        'audiencia',
        'asunto',
        'recurso',
        'persona'
      )
    ),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (form_template_code, code)
);

comment on table public.sierju_sections is
  'Hoja o bloque del formulario SIERJU (civil 1a escrito, movimiento tutelas, etc.).';

create table if not exists public.sierju_process_classes (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sierju_sections (id) on delete cascade,
  code text not null,
  label text not null,
  parent_class_id uuid references public.sierju_process_classes (id) on delete set null,
  tyba_process_hint text,
  metadata jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (section_id, code)
);

comment on table public.sierju_process_classes is
  'Fila TIPOS PROCESOS del Excel SIERJU. Clasificacion estadistica del expediente.';

create index if not exists sierju_process_classes_section_idx
  on public.sierju_process_classes (section_id, sort_order);

create table if not exists public.sierju_movement_types (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references public.sierju_sections (id) on delete cascade,
  code text not null,
  label text not null,
  movement_kind text not null
    check (
      movement_kind in (
        'inventario_inicial',
        'entrada',
        'salida',
        'inventario_final',
        'reactivado',
        'acumulado',
        'metrica'
      )
    ),
  is_effective boolean not null default true,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (section_id, code)
);

comment on table public.sierju_movement_types is
  'Columnas de movimiento SIERJU (reparto, sentencia, reingreso). section_id null = compartido proceso 1a.';

create index if not exists sierju_movement_types_section_idx
  on public.sierju_movement_types (section_id, sort_order)
  where section_id is not null;

-- Puente producto <-> estadistica
create table if not exists public.process_definition_sierju_classes (
  process_definition_id uuid not null references public.process_definitions (id) on delete cascade,
  sierju_process_class_id uuid not null references public.sierju_process_classes (id) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (process_definition_id, sierju_process_class_id)
);

comment on table public.process_definition_sierju_classes is
  'N:1 desde process_definitions (familia tramite) hacia clases SIERJU finas.';

-- Mapeo TYBA/SGDE -> clase SIERJU (completar con secretaria)
create table if not exists public.sierju_tyba_class_map (
  id uuid primary key default gen_random_uuid(),
  form_template_code text not null references public.sierju_form_templates (code) on delete cascade,
  tyba_label text not null,
  tyba_code text,
  sierju_process_class_id uuid not null references public.sierju_process_classes (id) on delete cascade,
  process_definition_id uuid references public.process_definitions (id) on delete set null,
  confidence text not null default 'manual'
    check (confidence in ('manual', 'heuristic', 'verified')),
  notes text,
  created_at timestamptz not null default now(),
  unique (form_template_code, tyba_label)
);

-- ---------------------------------------------------------------------------
-- Enlaces en courts / cases (clasificacion SIERJU en expediente)
-- ---------------------------------------------------------------------------

alter table public.courts
  add column if not exists sierju_form_template_code text
    references public.sierju_form_templates (code) on delete set null;

comment on column public.courts.sierju_form_template_code is
  'Formulario SIERJU que diligencia el despacho. Derivable del CUI/tipo entidad.';

alter table public.cases
  add column if not exists sierju_process_class_id uuid
    references public.sierju_process_classes (id) on delete set null,
  add column if not exists sierju_metadata jsonb not null default '{}'::jsonb;

comment on column public.cases.sierju_process_class_id is
  'Clase SIERJU del expediente (fila del formulario estadistico).';
comment on column public.cases.sierju_metadata is
  'Metadatos SIERJU: fundamental_right, procedure_mode, quantia_band, etc.';

create index if not exists cases_sierju_process_class_idx
  on public.cases (sierju_process_class_id)
  where sierju_process_class_id is not null;

-- ---------------------------------------------------------------------------
-- Helper seed clases por seccion
-- ---------------------------------------------------------------------------

create or replace function public._sierju_seed_section_classes (
  p_form_template_code text,
  p_section_code text,
  p_classes jsonb
)
returns void
language plpgsql
as $$
declare
  v_section_id uuid;
  c jsonb;
  i int := 0;
begin
  select id into v_section_id
  from public.sierju_sections
  where form_template_code = p_form_template_code
    and code = p_section_code;

  if v_section_id is null then
    raise exception 'sierju_sections %.% no existe', p_form_template_code, p_section_code;
  end if;

  delete from public.sierju_process_classes where section_id = v_section_id;

  for c in select * from jsonb_array_elements(p_classes)
  loop
    i := i + 1;
    insert into public.sierju_process_classes (section_id, code, label, sort_order)
    values (
      v_section_id,
      c->>'code',
      c->>'label',
      coalesce((c->>'order')::int, i)
    );
  end loop;
end;
$$;
-- ---------------------------------------------------------------------------
-- Seed catalogo (regenerar: npx tsx scripts/sierju/generate-sierju-seed-sql.mts)
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Seed catalogo (regenerar: npx tsx scripts/sierju/generate-sierju-seed-sql.mts)
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Seed catalogo (regenerar: npx tsx scripts/sierju/generate-sierju-seed-sql.mts)
-- ---------------------------------------------------------------------------

-- Auto-generated by scripts/sierju/generate-sierju-seed-sql.mts
-- Do not edit manually; regenerate from catalog-seed-data.json

insert into public.sierju_form_templates (code, label, version, effective_from, source_document)
values ('sierju_civil_circuito_2023_v4', 'SIERJU Juzgado Civil Circuito 2023 V.4', '2023_v4', '2023-01-01', 'docs/sierju/clases-civil-circuito-2023.md')
on conflict (code) do update set label = excluded.label, version = excluded.version, effective_from = excluded.effective_from, source_document = excluded.source_document;

insert into public.sierju_form_templates (code, label, version, effective_from, source_document)
values ('sierju_restitucion_tierras_2019', 'SIERJU Sala Civil Especializada Restitución de Tierras 2019', '2019', '2019-01-01', 'Manual UDAE Restitución de Tierras 2019')
on conflict (code) do update set label = excluded.label, version = excluded.version, effective_from = excluded.effective_from, source_document = excluded.source_document;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'civil_1a_escrito', 'Primera y única instancia Civil-Escrito', 'civil', 1, 'escrito', 'proceso', 1
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'civil_1a_oral', 'Primera y única instancia Civil-Oral', 'civil', 1, 'oral', 'proceso', 2
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'laboral_1a_escrito', 'Primera y única Instancia Laboral', 'laboral', 1, 'escrito', 'proceso', 3
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'laboral_1a_oral', 'Primera y única Instancia Laboral - Oral', 'laboral', 1, 'oral', 'proceso', 4
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'familia_1a_escrito', 'Primera y única Instancia Familia - Escrito', 'familia', 1, 'escrito', 'proceso', 5
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'familia_1a_oral', 'Primera y única Instancia Familia - Oral', 'familia', 1, 'oral', 'proceso', 6
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'acciones_const_1a', 'Primera instancia Acciones constitucionales', 'constitucional', 1, null, 'proceso', 7
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'movimiento_tutelas', 'Movimiento de Tutelas', 'constitucional', 1, null, 'tutela', 8
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'procesos_post_decision', 'Procesos iniciados después de un proceso decidido', 'civil', 1, null, 'proceso', 9
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'civil_2a_escrito', 'Segunda Instancia Civil - Escrito', 'civil', 2, 'escrito', 'proceso', 10
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'civil_2a_oral', 'Segunda Instancia Civil - Oral', 'civil', 2, 'oral', 'proceso', 11
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'incidentes_desacato', 'Incidentes de Desacato', 'constitucional', 1, null, 'incidente', 12
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'impugnaciones', 'Movimiento de Impugnaciones', 'constitucional', 2, null, 'impugnacion', 13
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'acciones_const_2a', 'Segunda Instancia Acciones Constitucionales', 'constitucional', 2, null, 'proceso', 14
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'consultas_desacato', 'Consultas Incidentes de Desacato', 'constitucional', 2, null, 'consulta', 15
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'tramite_posterior_actuaciones', 'Trámite posterior - Actuaciones', 'transversal', null, null, 'actuacion', 16
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'tramite_posterior_procesos', 'Trámite posterior - Procesos', 'transversal', null, null, 'proceso', 17
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'audiencias', 'Audiencias', 'transversal', null, null, 'audiencia', 18
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'otros_asuntos', 'Otros asuntos', 'transversal', null, null, 'asunto', 19
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'recursos_interpuestos', 'Recursos interpuestos contra providencias', 'transversal', null, null, 'recurso', 20
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'recursos_decididos_superiores', 'Recursos decididos por superiores', 'transversal', null, null, 'recurso', 21
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'actuaciones_especiales', 'Actuaciones especiales', 'transversal', null, null, 'actuacion', 22
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_civil_circuito_2023_v4', 'archivados', 'Procesos archivados definitivamente', 'transversal', null, null, 'proceso', 23
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_restitucion_tierras_2019', 'civil_1a_tierras', 'Primera y única instancia civil tierras', 'tierras', 1, null, 'proceso', 1
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_restitucion_tierras_2019', 'civil_1a_escrito', 'Primera o única instancia civil escrito (concurrente)', 'civil', 1, 'escrito', 'proceso', 2
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

insert into public.sierju_sections (
  form_template_code, code, label, specialty, instance_level, procedure_mode, unit_of_measure, sort_order
) values (
  'sierju_restitucion_tierras_2019', 'civil_1a_oral', 'Primera o única instancia civil oral (concurrente)', 'civil', 1, 'oral', 'proceso', 3
)
on conflict (form_template_code, code) do update set label = excluded.label, specialty = excluded.specialty, instance_level = excluded.instance_level, procedure_mode = excluded.procedure_mode, unit_of_measure = excluded.unit_of_measure, sort_order = excluded.sort_order;

select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'civil_1a_escrito', '[{"code":"declarativos_ordinarios","label":"DECLARATIVOS - ORDINARIOS","order":1},{"code":"declarativos_abreviados","label":"DECLARATIVOS - ABREVIADOS","order":2},{"code":"declarativos_verbales","label":"DECLARATIVOS - VERBALES","order":3},{"code":"declarativos_verbal_sumario","label":"DECLARATIVOS - VERBAL SUMARIO","order":4},{"code":"declarativos_divisorios","label":"DECLARATIVOS - DIVISORIOS","order":5},{"code":"declarativos_otros","label":"DECLARATIVOS - OTROS","order":6},{"code":"ejecutivos","label":"EJECUTIVOS","order":7},{"code":"ejecutivos_hipotecario","label":"EJECUTIVOS - HIPOTECARIO","order":8},{"code":"insolvencia_persona_natural","label":"INSOLVENCIA DE PERSONA NATURAL","order":9},{"code":"insolvencia_sociedades","label":"INSOLVENCIA DE SOCIEDADES","order":10},{"code":"liquidacion_sociedades_incumplimiento_reorg","label":"PROCESOS DE LIQUIDACIÓN - LIQUIDACIÓN DE SOCIEDADES POR INCUMPLIMIENTO DE ACUERDO DE REORGANIZACIÓN","order":11},{"code":"liquidacion_disolucion_nulidad_sociedades","label":"PROCESOS DE LIQUIDACIÓN - DISOLUCIÓN, NULIDAD Y LIQUIDACIÓN DE SOCIEDADES","order":12},{"code":"liquidacion_otros","label":"PROCESOS DE LIQUIDACIÓN - OTROS","order":13},{"code":"jurisdiccion_voluntaria","label":"PROCESOS DE JURISDICCIÓN VOLUNTARIA","order":14},{"code":"pertenencia","label":"PROCESOS DE PERTENENCIA","order":15},{"code":"servidumbres","label":"SERVIDUMBRES","order":16},{"code":"titulacion_predios","label":"TITULACIÓN DE PREDIOS","order":17},{"code":"liquidacion_sociedades_patrimoniales_hecho","label":"LIQUIDACIÓN DE SOCIEDADES PATRIMONIALES DE HECHO","order":18},{"code":"expropiacion","label":"EXPROPIACIÓN","order":19},{"code":"deslinde_amojonamiento","label":"DESLINDE Y AMOJONAMIENTO","order":20},{"code":"impugnacion_actas_asambleas","label":"IMPUGNACIÓN DE ACTAS DE ASAMBLEAS, JUNTAS DIRECTIVAS O DE SOCIOS.","order":21},{"code":"competencia_desleal","label":"COMPETENCIA DESLEAL","order":22},{"code":"rc_extracontractual","label":"RESPONSABILIDAD CIVIL EXTRACONTRACTUAL","order":23},{"code":"rc_contractual","label":"RESPONSABILIDAD CIVIL CONTRACTUAL","order":24},{"code":"conciliacion_extrajudicial","label":"CONCILIACIÓN EXTRAJUDICIAL","order":25},{"code":"otros_procesos","label":"OTROS PROCESOS","order":26}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'civil_1a_oral', '[{"code":"declarativos_verbal_pertenencia","label":"DECLARATIVOS VERBAL PERTENENCIA","order":1},{"code":"declarativos_verbal_servidumbres","label":"DECLARATIVOS VERBAL SERVIDUMBRES","order":2},{"code":"declarativos_verbal_impugnacion_actas","label":"DECLARATIVOS - VERBAL-IMPUGNACIÓN DE ACTAS DE ASAMBLEAS, JUNTAS DIRECTIVAS O DE SOCIOS.","order":3},{"code":"declarativos_verbal_bienes_vacantes","label":"DECLARATIVOS VERBAL DECLARACIÓN DE BIENES VACANTES O MOSTRENCOS","order":4},{"code":"declarativos_especiales_divisorio","label":"DECLARATIVOS ESPECIALES DIVISORIO","order":5},{"code":"declarativos_especiales_expropiacion","label":"DECLARATIVOS ESPECIALES EXPROPIACIÓN","order":6},{"code":"declarativos_especiales_deslinde","label":"DECLARATIVOS ESPECIALES DESLINDE Y AMOJONAMIENTO","order":7},{"code":"ejecutivos","label":"EJECUTIVOS","order":8},{"code":"ejecutivos_garantia_real","label":"EJECUTIVOS CON GARANTÍA REAL","order":9},{"code":"responsabilidad_medica","label":"RESPONSABILIDAD MEDICA","order":10},{"code":"rc_extracontractual","label":"RESPONSABILIDAD CIVIL EXTRACONTRACTUAL","order":11},{"code":"rc_contractual","label":"RESPONSABILIDAD CIVIL CONTRACTUAL","order":12},{"code":"insolvencia_persona_natural","label":"INSOLVENCIA DE LA PERSONA NATURAL","order":13},{"code":"insolvencia_sociedades","label":"INSOLVENCIA DE SOCIEDADES","order":14},{"code":"liquidacion_sociedades_incumplimiento_reorg","label":"PROCESOS DE LIQUIDACIÓN - LIQUIDACIÓN DE SOCIEDADES POR INCUMPLIMIENTO DE ACUERDO DE REORGANIZACIÓN","order":15},{"code":"liquidacion_disolucion_nulidad_sociedades","label":"PROCESOS DE LIQUIDACIÓN - DISOLUCIÓN, NULIDAD Y LIQUIDACIÓN DE SOCIEDADES","order":16},{"code":"liquidacion_otros","label":"PROCESOS DE LIQUIDACIÓN - OTROS","order":17},{"code":"jurisdiccion_voluntaria","label":"PROCESOS DE JURISDICCIÓN VOLUNTARIA","order":18},{"code":"competencia_desleal","label":"COMPETENCIA DESLEAL","order":19},{"code":"propiedad_intelectual","label":"PROPIEDAD INTELECTUAL","order":20},{"code":"proteccion_consumidor","label":"PROCESOS DE PROTECCIÓN DE DERECHO AL CONSUMIDOR","order":21},{"code":"declaratoria_ausencia_desaparicion","label":"DECLARATORIA DE AUSENCIA POR DESAPARICIÓN FORZADA","order":22},{"code":"conciliacion_extrajudicial","label":"CONCILIACIÓN EXTRAJUDICIAL","order":23},{"code":"otros_procesos","label":"OTROS PROCESOS","order":24}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'laboral_1a_escrito', '[{"code":"ordinarios","label":"ORDINARIOS","order":1},{"code":"ejecutivos","label":"EJECUTIVOS","order":2},{"code":"fuero_sindical","label":"FUERO SINDICAL","order":3},{"code":"sindicatos_suspension_disolucion","label":"SUSPENSIÓN, DISOLUCIÓN, LIQUIDACIÓN DE SINDICATOS Y CANCELACIÓN DE REGISTRO SINDICAL","order":4},{"code":"acoso_laboral_1010","label":"ACOSO LABORAL PREVISTO EN LA LEY 1010 DE 2006","order":5},{"code":"conciliacion_extrajudicial","label":"CONCILIACIÓN EXTRAJUDICIAL","order":6}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'laboral_1a_oral', '[{"code":"ordinarios_ss_unica","label":"ORDINARIOS - CONTROVERSIAS DE SEGURIDAD SOCIAL - ÚNICA INSTANCIA","order":1},{"code":"ordinarios_contrato_unica","label":"ORDINARIOS - CONTROVERSIAS CONTRATOS DE TRABAJO - ÚNICA INSTANCIA","order":2},{"code":"ordinarios_honorarios_unica","label":"ORDINARIOS - RECONOCIMIENTO DE HONORARIOS - ÚNICA INSTANCIA","order":3},{"code":"ordinarios_otros_unica","label":"ORDINARIOS - OTROS - ÚNICA INSTANCIA","order":4},{"code":"ordinarios_ss_primera","label":"ORDINARIOS - CONTROVERSIAS DE SEGURIDAD SOCIAL - PRIMERA INSTANCIA","order":5},{"code":"ordinarios_contrato_primera","label":"ORDINARIOS - CONTROVERSIAS CONTRATOS DE TRABAJO - PRIMERA INSTANCIA","order":6},{"code":"ordinarios_honorarios_primera","label":"ORDINARIOS - RECONOCIMIENTO DE HONORARIOS - PRIMERA INSTANCIA","order":7},{"code":"ordinarios_otros_primera","label":"ORDINARIOS - OTROS - PRIMERA INSTANCIA","order":8},{"code":"ejecutivos_ss","label":"EJECUTIVOS - SEGURIDAD SOCIAL","order":9},{"code":"ejecutivos_obligaciones_contrato","label":"EJECUTIVOS - OBLIGACIONES DERIVADAS DEL CONTRATO DE TRABAJO","order":10},{"code":"ejecutivos_aportes_parafiscales","label":"EJECUTIVOS - COBRO DE APORTES PARAFISCALES","order":11},{"code":"ejecutivos_otros","label":"EJECUTIVOS - OTROS","order":12},{"code":"fuero_sindical","label":"FUERO SINDICAL","order":13},{"code":"sindicatos_suspension_disolucion","label":"SUSPENSIÓN, DISOLUCIÓN, LIQUIDACIÓN DE SINDICATOS Y CANCELACIÓN DE REGISTRO SINDICAL","order":14},{"code":"acoso_laboral_1010","label":"ACOSO LABORAL PREVISTO EN LA LEY 1010 DE 2006","order":15},{"code":"conciliacion_extrajudicial","label":"CONCILIACIÓN EXTRAJUDICIAL","order":16},{"code":"otros_procesos","label":"OTROS PROCESOS","order":17}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'familia_1a_escrito', '[{"code":"alimentos","label":"FIJACIÓN, AUMENTO, DISMINUCIÓN O EXONERACIÓN DE ALIMENTOS","order":1},{"code":"union_marital_hecho","label":"DECLARATORIA DE UNIÓN MARITAL DE HECHO","order":2},{"code":"paternidad_maternidad","label":"INVESTIGACIÓN O IMPUGNACIÓN DE LA PATERNIDAD O LA MATERNIDAD.","order":3},{"code":"custodia","label":"CUSTODIA","order":4},{"code":"patria_potestad","label":"PATRIA POTESTAD","order":5},{"code":"divorcio_nulidad_matrimonio","label":"NULIDAD, DIVORCIO DE MATRIMONIO CIVIL O CESACIÓN DE EFECTOS CIVILES DEL MATRIMONIO RELIGIOSO","order":6},{"code":"liquidacion_sociedad_conyugal","label":"LIQUIDACIÓN DE SOCIEDAD CONYUGAL","order":7},{"code":"liquidacion_sucesion","label":"PROCESOS DE LIQUIDACIÓN - SUCESIÓN","order":8},{"code":"peticion_herencia","label":"PETICIÓN DE HERENCIA","order":9},{"code":"nulidad_testamento","label":"NULIDAD DE TESTAMENTO","order":10},{"code":"restitucion_internacional_nna","label":"RESTITUCIÓN INTERNACIONAL DE NNA","order":11},{"code":"restablecimiento_derecho_nna","label":"RESTABLECIMIENTO DERECHO NIÑOS-NIÑAS","order":12},{"code":"permiso_salir_pais","label":"PERMISO PARA SALIR DEL PAÍS","order":13},{"code":"adopcion","label":"ADOPCIÓN","order":14},{"code":"divorcio_comun_acuerdo","label":"DIVORCIO DE COMÚN ACUERDO","order":15},{"code":"declaratoria_ausencia_muerte","label":"DECLARATORIA DE AUSENCIA O MUERTE","order":16},{"code":"adjudicacion_apoyos","label":"ADJUDICACIÓN DE APOYOS","order":17},{"code":"jv_otros","label":"OTROS PROCESOS DE JURISDICCIÓN VOLUNTARIA","order":18},{"code":"ejecutivos","label":"EJECUTIVOS","order":19},{"code":"conciliacion_extrajudicial","label":"CONCILIACIÓN EXTRAJUDICIAL","order":20},{"code":"otros_procesos","label":"OTROS PROCESOS","order":21}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'familia_1a_oral', '[{"code":"alimentos","label":"FIJACIÓN, AUMENTO, DISMINUCIÓN O EXONERACIÓN DE ALIMENTOS","order":1},{"code":"union_marital_hecho","label":"DECLARATORIA DE UNIÓN MARITAL DE HECHO","order":2},{"code":"paternidad_maternidad","label":"INVESTIGACIÓN O IMPUGNACIÓN DE LA PATERNIDAD O LA MATERNIDAD.","order":3},{"code":"custodia","label":"CUSTODIA","order":4},{"code":"patria_potestad","label":"PATRIA POTESTAD","order":5},{"code":"divorcio_nulidad_matrimonio","label":"NULIDAD, DIVORCIO DE MATRIMONIO CIVIL O CESACIÓN DE EFECTOS CIVILES DEL MATRIMONIO RELIGIOSO","order":6},{"code":"liquidacion_sociedad_conyugal","label":"LIQUIDACIÓN DE SOCIEDAD CONYUGAL","order":7},{"code":"liquidacion_sucesion","label":"PROCESOS DE LIQUIDACIÓN - SUCESIÓN","order":8},{"code":"particion_patrimonio_vida","label":"PARTICIÓN DE PATRIMONIO EN VIDA","order":9},{"code":"peticion_herencia","label":"PETICIÓN DE HERENCIA","order":10},{"code":"nulidad_testamento","label":"NULIDAD DE TESTAMENTO","order":11},{"code":"medidas_proteccion_vif_infancia","label":"MEDIDAS DE PROTECCIÓN DE INFANCIA POR VIOLENCIA INTRAFAMILIAR","order":12},{"code":"restitucion_internacional_nna","label":"RESTITUCIÓN INTERNACIONAL DE NNA","order":13},{"code":"restablecimiento_derecho_nna","label":"RESTABLECIMIENTO DERECHO NIÑOS-NIÑAS","order":14},{"code":"permiso_salir_pais","label":"PERMISO PARA SALIR DEL PAÍS","order":15},{"code":"adopcion","label":"ADOPCIÓN","order":16},{"code":"divorcio_comun_acuerdo","label":"DIVORCIO DE COMÚN ACUERDO","order":17},{"code":"declaratoria_ausencia_muerte","label":"DECLARATORIA DE AUSENCIA O MUERTE","order":18},{"code":"adjudicacion_apoyos","label":"ADJUDICACIÓN DE APOYOS","order":19},{"code":"jv_otros","label":"OTROS PROCESOS DE JURISDICCIÓN VOLUNTARIA","order":20},{"code":"ejecutivos","label":"EJECUTIVOS","order":21},{"code":"conciliacion_extrajudicial","label":"CONCILIACIÓN EXTRAJUDICIAL","order":22},{"code":"otros_procesos","label":"OTROS PROCESOS","order":23}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'acciones_const_1a', '[{"code":"accion_cumplimiento","label":"ACCIONES CONSTITUCIONALES - ACCIÓN DE CUMPLIMIENTO","order":1},{"code":"accion_grupo","label":"ACCIONES CONSTITUCIONALES - ACCIONES DE GRUPO","order":2},{"code":"accion_popular","label":"ACCIONES CONSTITUCIONALES - ACCIONES POPULARES","order":3},{"code":"habeas_corpus","label":"ACCIÓN DE HÁBEAS CORPUS","order":4}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'movimiento_tutelas', '[{"code":"salud","label":"SALUD","order":1},{"code":"seguridad_social","label":"SEGURIDAD SOCIAL","order":2},{"code":"vida","label":"VIDA","order":3},{"code":"minimo_vital","label":"MÍNIMO VITAL","order":4},{"code":"igualdad","label":"IGUALDAD","order":5},{"code":"educacion","label":"EDUCACIÓN","order":6},{"code":"debido_proceso","label":"DEBIDO PROCESO","order":7},{"code":"derecho_peticion","label":"DERECHO DE PETICIÓN","order":8},{"code":"informacion_publica","label":"DERECHO A LA INFORMACIÓN PÚBLICA","order":9},{"code":"contra_providencias_judiciales","label":"CONTRA PROVIDENCIAS JUDICIALES","order":10},{"code":"medio_ambiente","label":"MEDIO AMBIENTE","order":11},{"code":"otros","label":"OTROS","order":12}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'procesos_post_decision', '[{"code":"ejecutivos","label":"EJECUTIVOS","order":1},{"code":"declarativos","label":"DECLARATIVOS","order":2},{"code":"otros_procesos","label":"OTROS PROCESOS","order":3}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'civil_2a_escrito', '[{"code":"declarativos_ordinarios","label":"DECLARATIVOS - ORDINARIOS","order":1},{"code":"declarativos_abreviados","label":"DECLARATIVOS - ABREVIADOS","order":2},{"code":"declarativos_verbales","label":"DECLARATIVOS - VERBALES","order":3},{"code":"declarativos_servidumbres","label":"DECLARATIVOS - SERVIDUMBRES","order":4},{"code":"declarativos_restitucion_inmueble_arrendado","label":"DECLARATIVOS - RESTITUCIÓN DE INMUEBLE ARRENDADO","order":5},{"code":"declarativos_posesorios","label":"DECLARATIVOS - POSESORIOS","order":6},{"code":"declarativos_verbal_bienes_vacantes","label":"DECLARATIVOS - VERBAL - DECLARACIÓN DE BIENES VACANTES O MOSTRENCOS.","order":7},{"code":"declarativos_especiales_deslinde","label":"DECLARATIVOS ESPECIALES DESLINDE Y AMOJONAMIENTO","order":8},{"code":"declarativos_especiales_divisorio","label":"DECLARATIVOS ESPECIALES DIVISORIO","order":9},{"code":"ejecutivos","label":"EJECUTIVOS","order":10},{"code":"ejecutivos_hipotecario","label":"EJECUTIVOS - HIPOTECARIO","order":11},{"code":"liquidacion_sociedades","label":"PROCESOS DE LIQUIDACIÓN - LIQUIDACIÓN DE SOCIEDADES","order":12},{"code":"liquidacion_sucesion","label":"PROCESOS DE LIQUIDACIÓN - SUCESIÓN","order":13},{"code":"responsabilidad_medica","label":"RESPONSABILIDAD MEDICA","order":14},{"code":"jurisdiccion_voluntaria","label":"PROCESOS DE JURISDICCIÓN VOLUNTARIA","order":15},{"code":"pertenencia","label":"PROCESOS DE PERTENENCIA","order":16},{"code":"titulacion_predios","label":"TITULACIÓN DE PREDIOS","order":17},{"code":"expropiaciones","label":"EXPROPIACIONES","order":18},{"code":"impugnacion_actas_asambleas","label":"IMPUGNACIÓN DE ACTAS DE ASAMBLEAS, JUNTAS DIRECTIVAS O DE SOCIOS.","order":19},{"code":"competencia_desleal","label":"COMPETENCIA DESLEAL","order":20},{"code":"otros_procesos","label":"OTROS PROCESOS","order":21}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'civil_2a_oral', '[{"code":"declarativos_verbal_pertenencia","label":"DECLARATIVOS VERBAL PERTENENCIA","order":1},{"code":"declarativos_verbal_servidumbres","label":"DECLARATIVOS VERBAL SERVIDUMBRES","order":2},{"code":"declarativos_verbal_posesorios","label":"DECLARATIVOS VERBAL POSESORIOS","order":3},{"code":"declarativos_verbal_bienes_vacantes","label":"DECLARATIVOS - VERBAL - DECLARACIÓN DE BIENES VACANTES O MOSTRENCOS.","order":4},{"code":"declarativos_verbal_restitucion_inmueble","label":"DECLARATIVOS - VERBAL - RESTITUCIÓN DE INMUEBLE ARRENDADO.","order":5},{"code":"declarativos_especiales_expropiacion","label":"DECLARATIVOS ESPECIALES EXPROPIACIÓN","order":6},{"code":"declarativos_especiales_deslinde","label":"DECLARATIVOS ESPECIALES DESLINDE Y AMOJONAMIENTO","order":7},{"code":"declarativos_especiales_divisorio","label":"DECLARATIVOS ESPECIALES DIVISORIO","order":8},{"code":"ejecutivos","label":"EJECUTIVOS","order":9},{"code":"ejecutivos_garantia_real","label":"EJECUTIVOS CON GARANTÍA REAL","order":10},{"code":"liquidacion_disolucion_nulidad_sociedades","label":"PROCESOS DE LIQUIDACIÓN - DISOLUCIÓN, NULIDAD Y LIQUIDACIÓN DE SOCIEDADES","order":11},{"code":"liquidacion_sucesion","label":"PROCESOS DE LIQUIDACIÓN - SUCESIÓN","order":12},{"code":"jurisdiccion_voluntaria","label":"PROCESOS DE JURISDICCIÓN VOLUNTARIA","order":13},{"code":"titulacion_predios","label":"TITULACIÓN DE PREDIOS","order":14},{"code":"responsabilidad_medica","label":"RESPONSABILIDAD MEDICA","order":15},{"code":"otros_procesos","label":"OTROS PROCESOS","order":16}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'incidentes_desacato', '[{"code":"salud","label":"SALUD","order":1},{"code":"seguridad_social","label":"SEGURIDAD SOCIAL","order":2},{"code":"vida","label":"VIDA","order":3},{"code":"minimo_vital","label":"MÍNIMO VITAL","order":4},{"code":"igualdad","label":"IGUALDAD","order":5},{"code":"educacion","label":"EDUCACIÓN","order":6},{"code":"debido_proceso","label":"DEBIDO PROCESO","order":7},{"code":"derecho_peticion","label":"DERECHO DE PETICIÓN","order":8},{"code":"informacion_publica","label":"DERECHO A LA INFORMACIÓN PÚBLICA","order":9},{"code":"contra_providencias_judiciales","label":"CONTRA PROVIDENCIAS JUDICIALES","order":10},{"code":"medio_ambiente","label":"MEDIO AMBIENTE","order":11},{"code":"otros","label":"OTROS","order":12}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'impugnaciones', '[{"code":"salud","label":"SALUD","order":1},{"code":"seguridad_social","label":"SEGURIDAD SOCIAL","order":2},{"code":"vida","label":"VIDA","order":3},{"code":"minimo_vital","label":"MÍNIMO VITAL","order":4},{"code":"igualdad","label":"IGUALDAD","order":5},{"code":"educacion","label":"EDUCACIÓN","order":6},{"code":"debido_proceso","label":"DEBIDO PROCESO","order":7},{"code":"derecho_peticion","label":"DERECHO DE PETICIÓN","order":8},{"code":"informacion_publica","label":"DERECHO A LA INFORMACIÓN PÚBLICA","order":9},{"code":"contra_providencias_judiciales","label":"CONTRA PROVIDENCIAS JUDICIALES","order":10},{"code":"medio_ambiente","label":"MEDIO AMBIENTE","order":11},{"code":"otros","label":"OTROS","order":12}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'acciones_const_2a', '[{"code":"habeas_corpus","label":"ACCIÓN DE HÁBEAS CORPUS","order":1}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'consultas_desacato', '[{"code":"salud","label":"SALUD","order":1},{"code":"seguridad_social","label":"SEGURIDAD SOCIAL","order":2},{"code":"vida","label":"VIDA","order":3},{"code":"minimo_vital","label":"MÍNIMO VITAL","order":4},{"code":"igualdad","label":"IGUALDAD","order":5},{"code":"educacion","label":"EDUCACIÓN","order":6},{"code":"debido_proceso","label":"DEBIDO PROCESO","order":7},{"code":"derecho_peticion","label":"DERECHO DE PETICIÓN","order":8},{"code":"informacion_publica","label":"DERECHO A LA INFORMACIÓN PÚBLICA","order":9},{"code":"contra_providencias_judiciales","label":"CONTRA PROVIDENCIAS JUDICIALES","order":10},{"code":"medio_ambiente","label":"MEDIO AMBIENTE","order":11},{"code":"otros","label":"OTROS","order":12}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'tramite_posterior_actuaciones', '[{"code":"avaluos","label":"AVALÚOS","order":1},{"code":"liquidacion_costas_creditos","label":"LIQUIDACIÓN DE COSTAS Y CRÉDITOS","order":2},{"code":"remates","label":"REMATES","order":3},{"code":"incidentes","label":"INCIDENTES","order":4},{"code":"medidas_cautelares","label":"SOLICITUDES SOBRE MEDIDAS CAUTELARES","order":5},{"code":"entrega_inmuebles","label":"ENTREGA DE INMUEBLES","order":6},{"code":"otros","label":"OTROS","order":7}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'tramite_posterior_procesos', '[{"code":"civiles","label":"CIVILES","order":1},{"code":"familia","label":"FAMILIA","order":2},{"code":"laboral","label":"LABORAL","order":3}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'audiencias', '[{"code":"civiles","label":"CIVILES","order":1},{"code":"laboral","label":"LABORAL","order":2},{"code":"familia","label":"FAMILIA","order":3}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'otros_asuntos', '[{"code":"despachos_comisorios","label":"DESPACHOS COMISORIOS","order":1},{"code":"pruebas_anticipadas","label":"PRUEBAS ANTICIPADAS","order":2},{"code":"inspecciones_judiciales","label":"INSPECCIONES JUDICIALES","order":3},{"code":"diligencias_practicar","label":"DILIGENCIAS A PRACTICAR","order":4},{"code":"conciliaciones_extrajudiciales","label":"CONCILIACIONES EXTRAJUDICIALES","order":5},{"code":"otros","label":"OTROS","order":6}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'recursos_interpuestos', '[{"code":"apelacion","label":"APELACIÓN","order":1},{"code":"reposicion","label":"REPOSICIÓN","order":2},{"code":"suplica","label":"SÚPLICA","order":3},{"code":"queja","label":"QUEJA","order":4},{"code":"consulta","label":"CONSULTA","order":5},{"code":"impugnacion","label":"IMPUGNACIÓN","order":6}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'recursos_decididos_superiores', '[{"code":"confirman","label":"CONFIRMAN TOTALMENTE LA DECISIÓN","order":1},{"code":"modifican","label":"MODIFICAN LA DECISIÓN","order":2},{"code":"revocan","label":"REVOCAN LA DECISIÓN","order":3},{"code":"decretan_nulidad","label":"DECRETAN NULIDAD","order":4},{"code":"inadmitidos","label":"INADMITIDOS","order":5},{"code":"desiertos","label":"DESIERTOS","order":6},{"code":"desistidos","label":"DESISTIDOS","order":7}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'actuaciones_especiales', '[{"code":"diligencias_remate","label":"DILIGENCIAS DE REMATE","order":1},{"code":"amparos_pobreza","label":"AMPAROS DE POBREZA","order":2},{"code":"asistencia_sesiones_sala","label":"ASISTENCIA A SESIONES DE SALA","order":3}]'::jsonb);
select public._sierju_seed_section_classes('sierju_civil_circuito_2023_v4', 'archivados', '[{"code":"procesos","label":"PROCESOS","order":1}]'::jsonb);
select public._sierju_seed_section_classes('sierju_restitucion_tierras_2019', 'civil_1a_tierras', '[{"code":"restitucion_comunidades_negras_4635","label":"Proceso rest. Derechos territoriales comunidades negras. Afro, palen, raizales (decreto 4635/2011)","order":1},{"code":"restitucion_comunidades_indigenas_4633","label":"Proceso rest. Derechos territoriales comunidades indígenas (decreto ley 4633/2011)","order":2},{"code":"restitucion_formalizacion_ley1448_cap3","label":"Proceso rest. y formalización de territorios despo. o abandonados (ley 1448 capítulo 3)","order":3},{"code":"restitucion_pueblo_rom_4634","label":"Proceso rest. Derechos territoriales pueblo rom o gitano (decreto 4634/2011)","order":4}]'::jsonb);
select public._sierju_seed_section_classes('sierju_restitucion_tierras_2019', 'civil_1a_escrito', '[{"code":"recurso_revision","label":"Recurso de revisión","order":1},{"code":"otros_procesos","label":"Otros procesos","order":2}]'::jsonb);
select public._sierju_seed_section_classes('sierju_restitucion_tierras_2019', 'civil_1a_oral', '[{"code":"recurso_revision","label":"Recurso de revisión","order":1},{"code":"recursos_anulacion_laudos","label":"Recursos de anulación de laudos","order":2},{"code":"otros_procesos","label":"Otros procesos","order":3}]'::jsonb);

-- Movement types (shared proceso 1a instancia)
insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'inventario_inicial_con_tramite', 'INVENTARIO AL INICIAR EL PERIODO - CON TRÁMITE', 'inventario_inicial', true, 1)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'inventario_inicial_sin_tramite', 'INVENTARIO AL INICIAR EL PERIODO - SIN TRÁMITE', 'inventario_inicial', true, 2)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_reparto', 'POR REPARTO', 'entrada', true, 3)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_descongestion', 'DESCONGESTIÓN', 'entrada', true, 4)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_reingreso', 'REINGRESO', 'entrada', true, 5)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_conocimiento_previo', 'INGRESO POR CONOCIMIENTO PREVIO', 'entrada', true, 6)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_cambio_radicacion', 'INGRESO CAMBIO DE RADICACIÓN', 'entrada', true, 7)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_perdida_competencia', 'INGRESO PÉRDIDA DE COMPETENCIA', 'entrada', true, 8)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_renovar_actuacion', 'INGRESO PARA RENOVAR ACTUACIÓN', 'entrada', true, 9)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_recibido_otros_despachos', 'RECIBIDO DE OTROS DESPACHOS SIN FALLO O DECISIÓN DEFINITIVA', 'entrada', true, 10)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'entrada_otras_no_efectivas', 'OTRAS ENTRADAS NO EFECTIVAS', 'entrada', false, 11)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'procesos_reactivados', 'PROCESOS REACTIVADOS', 'reactivado', true, 12)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_descongestion', 'PARA DESCONGESTIÓN', 'salida', true, 13)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_remitidos', 'REMITIDOS A OTROS DESPACHOS', 'salida', true, 14)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_rechazados_retirados', 'RECHAZADOS O RETIRADOS', 'salida', true, 15)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_auto_pago', 'AUTOS - PAGO', 'salida', true, 16)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_auto_transaccion', 'AUTOS - TRANSACCIÓN', 'salida', true, 17)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_conciliacion_judicial', 'AUTO APRUEBA CONCILIACIÓN JUDICIAL', 'salida', true, 18)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_desistimiento', 'AUTOS - DESISTIMIENTO', 'salida', true, 19)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_desistimiento_tacito', 'DESISTIMIENTO TÁCITO', 'salida', true, 20)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_seguir_ejecucion', 'AUTO ORDENA SEGUIR EJECUCIÓN', 'salida', true, 21)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_sentencias', 'SENTENCIAS', 'salida', true, 22)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_cambio_radicacion', 'SALIDA CAMBIO DE RADICACIÓN', 'salida', true, 23)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_perdida_competencia', 'SALIDA PÉRDIDA DE COMPETENCIA', 'salida', true, 24)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_conciliacion_extrajudicial_aprueba', 'AUTO APRUEBA CONCILIACIÓN EXTRAJUDICIAL', 'salida', true, 25)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_conciliacion_extrajudicial_imprueba', 'AUTO IMPRUEBA CONCILIACIÓN EXTRAJUDICIAL', 'salida', true, 26)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_otras_no_efectivas', 'OTRAS SALIDAS NO EFECTIVAS', 'salida', false, 27)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'salida_otras_terminaciones_efectivas', 'OTRAS TERMINACIONES EFECTIVAS DEL PROCESO', 'salida', true, 28)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'procesos_acumulados', 'PROCESOS ACUMULADOS', 'acumulado', true, 29)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'sin_tramite_durante_periodo', 'PROCESOS SIN TRÁMITE DURANTE EL PERIODO', 'metrica', true, 30)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'inventario_final_con_tramite', 'INVENTARIO AL FINAL DEL PERIODO - CON TRÁMITE', 'inventario_final', true, 31)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'inventario_final_sin_tramite', 'INVENTARIO AL FINAL DEL PERIODO - SIN TRÁMITE', 'inventario_final', true, 32)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'procesos_para_fallo', 'PROCESOS PARA FALLO', 'metrica', true, 33)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
values (null, 'sentencias_escritas_procesos_orales', 'CANTIDAD DE SENTENCIAS ESCRITAS EN PROCESOS ORALES', 'metrica', true, 34)
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

-- Movement types (movimiento_tutelas)
insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_inventario_inicial', 'INVENTARIO DE TUTELAS AL INICIAR EL PERIODO', 'inventario_inicial', true, 1
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_entrada_reparto', 'INGRESO POR REPARTO DE TUTELAS DURANTE EL PERIODO', 'entrada', true, 2
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_entrada_reingreso_nulidad_competencia', 'REINGRESO POR NULIDAD O COMPETENCIA TUTELAS', 'entrada', true, 3
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_entrada_competencia', 'INGRESO POR COMPETENCIA', 'entrada', true, 4
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_entrada_impedimentos', 'ENTRADA IMPEDIMENTOS', 'entrada', true, 5
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_entrada_otras_no_efectivas', 'OTRAS ENTRADAS NO EFECTIVAS', 'entrada', false, 6
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_concede', 'CONCEDE', 'salida', true, 7
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_niega', 'NIEGA', 'salida', true, 8
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_improcedente', 'DECLARA IMPROCEDENTE', 'salida', true, 9
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_falta_competencia', 'FALTA DE COMPETENCIA', 'salida', true, 10
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_impedimentos', 'SALIDA IMPEDIMENTOS', 'salida', true, 11
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_hecho_superado', 'HECHO SUPERADO', 'salida', true, 12
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_rechaza', 'RECHAZA', 'salida', true, 13
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_conocimiento_previo', 'RECHAZA POR CONOCIMIENTO PREVIO (REMITE A OTROS DESPACHOS)', 'salida', true, 14
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_retiro_voluntario', 'RETIRO VOLUNTARIO', 'salida', true, 15
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_salida_otras_no_efectivas', 'OTRAS SALIDAS NO EFECTIVAS', 'salida', false, 16
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'tutela_inventario_final', 'INVENTARIO DE TUTELAS AL FINALIZAR EL PERIODO', 'inventario_final', true, 17
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'movimiento_tutelas'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

-- Movement types (incidentes_desacato)
insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'desacato_entrada_periodo', 'INGRESO DE INCIDENTES DE DESACATO DURANTE EL PERIODO', 'entrada', true, 1
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'incidentes_desacato'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'desacato_entrada_reingreso_nulidad', 'REINGRESO POR NULIDAD INCIDENTES DE DESACATO', 'entrada', true, 2
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'incidentes_desacato'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'desacato_salida_sanciona', 'SANCIONA', 'salida', true, 3
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'incidentes_desacato'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'desacato_salida_no_sanciona_archiva', 'NO SANCIONA - ARCHIVA', 'salida', true, 4
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'incidentes_desacato'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

-- Movement types (impugnaciones)
insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'impugnacion_entrada_reparto', 'INGRESO POR REPARTO IMPUGNACIONES', 'entrada', true, 1
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'impugnaciones'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'impugnacion_salida_confirma', 'CONFIRMA', 'salida', true, 2
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'impugnaciones'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'impugnacion_salida_revoca', 'REVOCA', 'salida', true, 3
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'impugnaciones'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'impugnacion_salida_modifica', 'MODIFICA', 'salida', true, 4
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'impugnaciones'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'impugnacion_salida_rechaza_extemporanea', 'RECHAZA POR EXTEMPORÁNEA', 'salida', true, 5
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'impugnaciones'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

insert into public.sierju_movement_types (section_id, code, label, movement_kind, is_effective, sort_order)
select s.id, 'impugnacion_salida_decreta_nulidad', 'DECRETA NULIDAD', 'salida', true, 6
from public.sierju_sections s where s.form_template_code = 'sierju_civil_circuito_2023_v4' and s.code = 'impugnaciones'
on conflict (section_id, code) do update set label = excluded.label, movement_kind = excluded.movement_kind, is_effective = excluded.is_effective, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Despacho piloto J051 + puente process_definitions <-> clases constitucionales
-- ---------------------------------------------------------------------------

update public.courts
set sierju_form_template_code = 'sierju_civil_circuito_2023_v4'
where id = 'court-1'
  and (sierju_form_template_code is null or sierju_form_template_code <> 'sierju_civil_circuito_2023_v4');

insert into public.process_definition_sierju_classes (process_definition_id, sierju_process_class_id, is_default)
select pd.id, spc.id, spc.code = 'otros'
from public.process_definitions pd
cross join public.sierju_process_classes spc
inner join public.sierju_sections ss on ss.id = spc.section_id
where pd.code in ('tutela_primera', 'tutela_segunda')
  and ss.form_template_code = 'sierju_civil_circuito_2023_v4'
  and ss.code = 'movimiento_tutelas'
on conflict do nothing;

insert into public.process_definition_sierju_classes (process_definition_id, sierju_process_class_id, is_default)
select pd.id, spc.id, spc.code = 'otros'
from public.process_definitions pd
cross join public.sierju_process_classes spc
inner join public.sierju_sections ss on ss.id = spc.section_id
where pd.code = 'consulta_desacato'
  and ss.form_template_code = 'sierju_civil_circuito_2023_v4'
  and ss.code = 'consultas_desacato'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS: catalogo SIERJU = lectura authenticated; escritura solo service_role
-- ---------------------------------------------------------------------------

alter table public.sierju_form_templates enable row level security;
alter table public.sierju_sections enable row level security;
alter table public.sierju_process_classes enable row level security;
alter table public.sierju_movement_types enable row level security;
alter table public.process_definition_sierju_classes enable row level security;
alter table public.sierju_tyba_class_map enable row level security;

drop policy if exists sierju_form_templates_select on public.sierju_form_templates;
create policy sierju_form_templates_select on public.sierju_form_templates
  for select to authenticated using (true);

drop policy if exists sierju_sections_select on public.sierju_sections;
create policy sierju_sections_select on public.sierju_sections
  for select to authenticated using (true);

drop policy if exists sierju_process_classes_select on public.sierju_process_classes;
create policy sierju_process_classes_select on public.sierju_process_classes
  for select to authenticated using (true);

drop policy if exists sierju_movement_types_select on public.sierju_movement_types;
create policy sierju_movement_types_select on public.sierju_movement_types
  for select to authenticated using (true);

drop policy if exists process_definition_sierju_classes_select on public.process_definition_sierju_classes;
create policy process_definition_sierju_classes_select on public.process_definition_sierju_classes
  for select to authenticated using (true);

drop policy if exists sierju_tyba_class_map_select on public.sierju_tyba_class_map;
create policy sierju_tyba_class_map_select on public.sierju_tyba_class_map
  for select to authenticated using (true);
