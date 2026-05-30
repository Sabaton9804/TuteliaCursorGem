-- Fase 1: catálogo judicial + definiciones de proceso + CUI en courts.
-- Runtime TS sigue en case-workflow-stages.ts hasta Fase 2.
-- courts.id permanece text (court-1, court-050, …).

-- ---------------------------------------------------------------------------
-- Capa 1: catálogo judicial (referencia)
-- ---------------------------------------------------------------------------

create table if not exists public.judicial_territories (
  id uuid primary key default gen_random_uuid(),
  dane_code text not null unique,
  name text not null,
  department text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.judicial_territories is
  'Territorios con código DANE. Referencia nacional; no es tenant.';

create table if not exists public.judicial_entity_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  typical_instance smallint not null default 1 check (typical_instance between 1 and 3),
  created_at timestamptz not null default now()
);

comment on table public.judicial_entity_categories is
  'Categoría de entidad: municipal, circuito, tribunal, pequenas_causas, suprema. typical_instance es orientativo.';

create table if not exists public.judicial_specialties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  created_at timestamptz not null default now()
);

comment on table public.judicial_specialties is
  'Especialidad judicial: civil, laboral, penal, etc.';

-- ---------------------------------------------------------------------------
-- Capa 2: definición de procesos
-- ---------------------------------------------------------------------------

create table if not exists public.process_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  process_domain text not null default 'constitucional'
    check (
      process_domain in (
        'constitucional',
        'civil',
        'laboral',
        'penal',
        'familia',
        'administrativo',
        'transversal'
      )
    ),
  instance_level smallint not null default 1 check (instance_level between 1 and 3),
  specialty_id uuid references public.judicial_specialties (id) on delete set null,
  entity_category_id uuid references public.judicial_entity_categories (id) on delete set null,
  description text,
  case_term_days int,
  case_term_type text not null default 'none'
    check (case_term_type in ('habiles', 'calendario', 'none')),
  is_active boolean not null default true,
  legacy_case_type text
    check (
      legacy_case_type is null
      or legacy_case_type in ('tutela_primera', 'tutela_segunda', 'consulta_desacato')
    ),
  created_at timestamptz not null default now()
);

comment on table public.process_definitions is
  'Tipo de proceso (tutela, civil ordinario, etc.). cases.process_definition_id apunta aquí.';
comment on column public.process_definitions.legacy_case_type is
  'Puente con cases.case_type durante migración gradual.';
comment on column public.process_definitions.case_term_days is
  'Plazo global del caso (ej. tutela: 10 días hábiles desde radicación → cases.deadline_at).';

create table if not exists public.process_stages_definition (
  id uuid primary key default gen_random_uuid(),
  process_definition_id uuid not null references public.process_definitions (id) on delete cascade,
  code text not null,
  label text not null,
  order_index int not null,
  stage_kind text not null default 'linear'
    check (stage_kind in ('linear', 'branch', 'terminal', 'optional')),
  term_days int,
  term_type text not null default 'none'
    check (term_type in ('habiles', 'calendario', 'none')),
  responsible_role text
    check (responsible_role is null or responsible_role in ('secretaria', 'despacho')),
  generates_alert boolean not null default false,
  alert_threshold_pct smallint not null default 75
    check (alert_threshold_pct between 0 and 100),
  workflow_task_type text
    check (workflow_task_type is null or workflow_task_type in ('custom', 'generate_notifs')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (process_definition_id, code),
  unique (process_definition_id, order_index)
);

comment on table public.process_stages_definition is
  'Etapas ordenadas por tipo de proceso. Alineado a CaseStageCode y case_stages.stage_code.';
comment on column public.process_stages_definition.responsible_role is
  'secretaria | despacho — mismo vocabulario que case_stages.responsible_role.';

create table if not exists public.process_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  process_definition_id uuid not null references public.process_definitions (id) on delete cascade,
  from_stage_code text not null,
  to_stage_code text not null,
  label text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (process_definition_id, from_stage_code, to_stage_code)
);

comment on table public.process_stage_transitions is
  'Grafo de transiciones (ramas: INADMISION, RECHAZO). Fase 2 cablea runtime.';

-- ---------------------------------------------------------------------------
-- Capa 3: courts — CUI + FKs catálogo
-- ---------------------------------------------------------------------------

alter table public.courts
  add column if not exists dane_code text,
  add column if not exists entity_code text,
  add column if not exists specialty_code text,
  add column if not exists despacho_number text,
  add column if not exists territory_id uuid references public.judicial_territories (id) on delete set null,
  add column if not exists entity_category_id uuid references public.judicial_entity_categories (id) on delete set null,
  add column if not exists judicial_specialty_id uuid references public.judicial_specialties (id) on delete set null;

comment on column public.courts.dane_code is 'Código DANE territorio (5 dígitos), ej. 11001.';
comment on column public.courts.entity_code is 'Entidad CUI (2 dígitos), ej. 31 circuito civil, 40 municipal.';
comment on column public.courts.specialty_code is 'Especialidad CUI (2 dígitos), ej. 03 civil.';
comment on column public.courts.despacho_number is 'Número despacho CUI (3 dígitos), ej. 051.';

create table if not exists public.court_enabled_processes (
  court_id text not null references public.courts (id) on delete cascade,
  process_definition_id uuid not null references public.process_definitions (id) on delete cascade,
  enabled_at timestamptz not null default now(),
  primary key (court_id, process_definition_id)
);

comment on table public.court_enabled_processes is
  'Procesos que un despacho puede radicar (tutela + ordinario + …).';

-- ---------------------------------------------------------------------------
-- Capa 4: cases / case_stages — enlaces a definición
-- ---------------------------------------------------------------------------

alter table public.cases
  add column if not exists process_definition_id uuid references public.process_definitions (id) on delete restrict;

comment on column public.cases.process_definition_id is
  'Tipo de proceso. Coexiste con case_type hasta migración completa del runtime.';

alter table public.case_stages
  add column if not exists stage_definition_id uuid references public.process_stages_definition (id) on delete set null;

comment on column public.case_stages.stage_definition_id is
  'Etapa de definición (Fase 2). stage_code sigue siendo la clave operativa hasta relajar CHECK.';

create index if not exists cases_process_definition_idx on public.cases (process_definition_id);
create index if not exists case_stages_stage_definition_idx on public.case_stages (stage_definition_id);

-- ---------------------------------------------------------------------------
-- Utilidad: prefijo radicado (16 dígitos antes de consecutivo + instancia)
-- ---------------------------------------------------------------------------

create or replace function public.court_radicacion_prefix (p_court_id text, p_year int)
returns text
language sql
stable
as $$
  select
    coalesce(nullif(trim(c.dane_code), ''), '')
    || coalesce(nullif(trim(c.entity_code), ''), '')
    || coalesce(nullif(trim(c.specialty_code), ''), '')
    || coalesce(nullif(trim(c.despacho_number), ''), '')
    || lpad(greatest(p_year, 1998)::text, 4, '0')
  from public.courts c
  where c.id = p_court_id;
$$;

comment on function public.court_radicacion_prefix (text, int) is
  'Primeros 16 caracteres del CUI (territorio+entidad+especialidad+despacho+año).';

-- ---------------------------------------------------------------------------
-- Seed: catálogo mínimo Bogotá
-- ---------------------------------------------------------------------------

insert into public.judicial_territories (dane_code, name, department)
values ('11001', 'Bogotá D.C.', 'Cundinamarca')
on conflict (dane_code) do update set
  name = excluded.name,
  department = excluded.department;

insert into public.judicial_entity_categories (code, label, typical_instance)
values
  ('municipal', 'Juzgado Municipal', 1),
  ('circuito', 'Juzgado del Circuito', 1),
  ('tribunal', 'Tribunal Superior', 2),
  ('pequenas_causas', 'Juzgado de Pequeñas Causas', 1),
  ('suprema', 'Corte Suprema de Justicia', 3)
on conflict (code) do update set
  label = excluded.label,
  typical_instance = excluded.typical_instance;

insert into public.judicial_specialties (code, label)
values
  ('civil', 'Civil'),
  ('laboral', 'Laboral'),
  ('penal', 'Penal'),
  ('familia', 'Familia'),
  ('administrativo', 'Administrativo')
on conflict (code) do update set label = excluded.label;

-- ---------------------------------------------------------------------------
-- Seed: process_definitions (tutela — alineado a case-workflow-stages.ts)
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
  'constitucional',
  v.instance_level,
  null,
  null,
  v.case_term_days,
  v.case_term_type,
  v.legacy_case_type,
  v.description
from (
  values
    (
      'tutela_primera'::text,
      'Tutela — Primera instancia'::text,
      1::smallint,
      10::int,
      'habiles'::text,
      'tutela_primera'::text,
      'Plazo global 10 días hábiles desde radicación (cases.deadline_at).'::text
    ),
    (
      'tutela_segunda',
      'Tutela — Segunda instancia',
      2::smallint,
      null::int,
      'none',
      'tutela_segunda',
      'Segunda instancia; plazo global distinto al de primera.'
    ),
    (
      'consulta_desacato',
      'Consulta de desacato',
      2::smallint,
      null::int,
      'none',
      'consulta_desacato',
      'Radicación tipo consulta; incidente en expediente madre sigue modelo cerrado.'
    )
) as v (code, label, instance_level, case_term_days, case_term_type, legacy_case_type, description)
on conflict (code) do update set
  label = excluded.label,
  process_domain = excluded.process_domain,
  instance_level = excluded.instance_level,
  case_term_days = excluded.case_term_days,
  case_term_type = excluded.case_term_type,
  legacy_case_type = excluded.legacy_case_type,
  description = excluded.description;

-- Helper: insertar etapas de un proceso desde filas VALUES
create or replace function public._seed_process_stages (
  p_process_code text,
  p_stages jsonb
)
returns void
language plpgsql
as $$
declare
  v_pid uuid;
  st jsonb;
  i int := 0;
begin
  select id into v_pid from public.process_definitions where code = p_process_code;
  if v_pid is null then
    raise exception 'process_definitions % no existe', p_process_code;
  end if;

  delete from public.process_stages_definition where process_definition_id = v_pid;

  for st in select * from jsonb_array_elements(p_stages)
  loop
    i := i + 1;
    insert into public.process_stages_definition (
      process_definition_id,
      code,
      label,
      order_index,
      stage_kind,
      term_days,
      term_type,
      responsible_role,
      generates_alert,
      alert_threshold_pct,
      workflow_task_type
    )
    values (
      v_pid,
      st ->> 'code',
      st ->> 'label',
      coalesce((st ->> 'order_index')::int, i),
      coalesce(st ->> 'stage_kind', 'linear'),
      nullif(st ->> 'term_days', '')::int,
      coalesce(st ->> 'term_type', 'none'),
      nullif(st ->> 'responsible_role', ''),
      coalesce((st ->> 'generates_alert')::boolean, false),
      coalesce((st ->> 'alert_threshold_pct')::smallint, 75),
      nullif(st ->> 'workflow_task_type', '')
    );
  end loop;
end;
$$;

-- tutela_primera — STAGE_PIPELINE_BY_CASE_TYPE + responsibleRoleForStage + case-stage-deadlines
select public._seed_process_stages(
  'tutela_primera',
  '[
    {"code":"RADICACION","label":"Radicación","responsible_role":"secretaria"},
    {"code":"ADMISION","label":"Admisión","responsible_role":"despacho","workflow_task_type":"generate_notifs"},
    {"code":"NOTIFICACION_AUTO_ADMISORIO","label":"Notificación auto admisorio","responsible_role":"secretaria"},
    {"code":"TERMINO_RESPUESTA","label":"Término de respuesta","responsible_role":"secretaria","term_days":2,"term_type":"habiles","generates_alert":true},
    {"code":"INGRESO_DESPACHO_FALLO","label":"Ingreso despacho / fallo","responsible_role":"despacho"},
    {"code":"FALLO","label":"Fallo","responsible_role":"despacho","workflow_task_type":"generate_notifs"},
    {"code":"NOTIFICACION_FALLO","label":"Notificación del fallo","responsible_role":"secretaria"},
    {"code":"TERMINO_IMPUGNACION","label":"Término de impugnación","responsible_role":"secretaria","term_days":3,"term_type":"habiles","generates_alert":true},
    {"code":"EJECUTORIA","label":"Ejecutoria","responsible_role":"despacho"},
    {"code":"REMISION_CORTE","label":"Remisión a Corte","responsible_role":"secretaria","term_days":10,"term_type":"habiles","generates_alert":true}
  ]'::jsonb
);

select public._seed_process_stages(
  'tutela_segunda',
  '[
    {"code":"RADICACION","label":"Radicación","responsible_role":"secretaria"},
    {"code":"INGRESO_DESPACHO_FALLO","label":"Ingreso despacho / fallo","responsible_role":"despacho"},
    {"code":"FALLO","label":"Fallo","responsible_role":"despacho","workflow_task_type":"generate_notifs"},
    {"code":"NOTIFICACION_FALLO","label":"Notificación del fallo","responsible_role":"secretaria"},
    {"code":"EJECUTORIA","label":"Ejecutoria","responsible_role":"despacho"},
    {"code":"REMISION_CORTE","label":"Remisión a Corte","responsible_role":"secretaria","term_days":10,"term_type":"habiles","generates_alert":true}
  ]'::jsonb
);

select public._seed_process_stages(
  'consulta_desacato',
  '[
    {"code":"RADICACION","label":"Radicación","responsible_role":"secretaria"},
    {"code":"INGRESO_DESPACHO_FALLO","label":"Ingreso despacho / fallo","responsible_role":"despacho"},
    {"code":"FALLO","label":"Fallo","responsible_role":"despacho","workflow_task_type":"generate_notifs"},
    {"code":"NOTIFICACION_FALLO","label":"Notificación del fallo","responsible_role":"secretaria"},
    {"code":"EJECUTORIA","label":"Ejecutoria","responsible_role":"despacho"}
  ]'::jsonb
);

-- Ramas futuras (INADMISION / RECHAZO) — transiciones, no en carril lineal actual
insert into public.process_stage_transitions (process_definition_id, from_stage_code, to_stage_code, label, is_default)
select pd.id, t.from_code, t.to_code, t.lbl, t.is_def
from public.process_definitions pd
cross join (
  values
    ('ADMISION', 'INADMISION', 'Inadmisión', false),
    ('ADMISION', 'NOTIFICACION_AUTO_ADMISORIO', 'Admisión — continuar carril', true),
    ('INADMISION', 'RADICACION', 'Cierre / archivo', false)
) as t (from_code, to_code, lbl, is_def)
where pd.code = 'tutela_primera'
on conflict (process_definition_id, from_stage_code, to_stage_code) do nothing;

drop function if exists public._seed_process_stages (text, jsonb);

-- ---------------------------------------------------------------------------
-- Seed: CUI en courts demo + procesos habilitados
-- ---------------------------------------------------------------------------

update public.courts c
set
  dane_code = '11001',
  entity_code = '31',
  specialty_code = '03',
  despacho_number = case c.id
    when 'court-1' then '051'
    when 'court-050' then '050'
    when 'court-052' then '052'
    when 'court-053' then '053'
    else coalesce(c.despacho_number, '051')
  end,
  territory_id = (select id from public.judicial_territories where dane_code = '11001'),
  entity_category_id = (select id from public.judicial_entity_categories where code = 'circuito'),
  judicial_specialty_id = (select id from public.judicial_specialties where code = 'civil'),
  updated_at = now()
where c.id in ('court-1', 'court-050', 'court-052', 'court-053')
   or c.dane_code is null;

insert into public.court_enabled_processes (court_id, process_definition_id)
select c.id, pd.id
from public.courts c
cross join public.process_definitions pd
where c.id = 'court-1'
  and pd.code in ('tutela_primera', 'tutela_segunda', 'consulta_desacato')
on conflict do nothing;

-- Backfill cases.process_definition_id desde case_type
update public.cases c
set process_definition_id = pd.id
from public.process_definitions pd
where pd.legacy_case_type = c.case_type
  and c.process_definition_id is null;

-- ---------------------------------------------------------------------------
-- RLS: catálogo y definiciones = lectura authenticated; escritura solo service_role
-- ---------------------------------------------------------------------------

alter table public.judicial_territories enable row level security;
alter table public.judicial_entity_categories enable row level security;
alter table public.judicial_specialties enable row level security;
alter table public.process_definitions enable row level security;
alter table public.process_stages_definition enable row level security;
alter table public.process_stage_transitions enable row level security;
alter table public.court_enabled_processes enable row level security;

drop policy if exists judicial_territories_select on public.judicial_territories;
create policy judicial_territories_select on public.judicial_territories
  for select to authenticated using (true);

drop policy if exists judicial_entity_categories_select on public.judicial_entity_categories;
create policy judicial_entity_categories_select on public.judicial_entity_categories
  for select to authenticated using (true);

drop policy if exists judicial_specialties_select on public.judicial_specialties;
create policy judicial_specialties_select on public.judicial_specialties
  for select to authenticated using (true);

drop policy if exists process_definitions_select on public.process_definitions;
create policy process_definitions_select on public.process_definitions
  for select to authenticated using (true);

drop policy if exists process_stages_definition_select on public.process_stages_definition;
create policy process_stages_definition_select on public.process_stages_definition
  for select to authenticated using (true);

drop policy if exists process_stage_transitions_select on public.process_stage_transitions;
create policy process_stage_transitions_select on public.process_stage_transitions
  for select to authenticated using (true);

drop policy if exists court_enabled_processes_select_same_court on public.court_enabled_processes;
create policy court_enabled_processes_select_same_court on public.court_enabled_processes
  for select to authenticated using (
    exists (
      select 1
      from public.profiles v
      where v.id = auth.uid()
        and (v.court_id = court_enabled_processes.court_id or v.is_superuser = true)
    )
  );
