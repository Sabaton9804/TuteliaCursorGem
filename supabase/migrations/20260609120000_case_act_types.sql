-- Catálogo de actos procesales (piezas humanas) y requisitos para transiciones de etapa.
-- Referencia: práctica del despacho (carpetas numeradas), no SGDE como fuente primaria.

-- ---------------------------------------------------------------------------
-- Catálogo por tipo de proceso
-- ---------------------------------------------------------------------------

create table if not exists public.case_act_types (
  id uuid primary key default gen_random_uuid(),
  process_definition_id uuid not null references public.process_definitions (id) on delete cascade,
  code text not null,
  label_es text not null,
  suggested_filename text,
  stage_code text,
  responsible_role text
    check (
      responsible_role is null
      or responsible_role in (
        'secretaria',
        'despacho',
        'escribiente',
        'sustanciador',
        'oficial_mayor'
      )
    ),
  sort_band smallint not null default 50 check (sort_band between 1 and 99),
  is_repeatable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (process_definition_id, code)
);

comment on table public.case_act_types is
  'Actos procesales esperados por tipo de proceso (correo reparto, auto admite, respuesta accionado…).';
comment on column public.case_act_types.sort_band is
  'Banda de orden humano (01–99) para índice y timeline; no sustituye sort_order del expediente.';
comment on column public.case_act_types.is_repeatable is
  'true para actos que pueden repetirse (respuesta_accionado, correo_contestacion).';

create index if not exists case_act_types_process_sort_idx
  on public.case_act_types (process_definition_id, sort_band, code);

-- ---------------------------------------------------------------------------
-- Requisitos de piezas para disparadores de etapa (gates)
-- ---------------------------------------------------------------------------

create table if not exists public.process_stage_act_requirements (
  id uuid primary key default gen_random_uuid(),
  process_definition_id uuid not null references public.process_definitions (id) on delete cascade,
  trigger_code text not null,
  requirement_mode text not null default 'any'
    check (requirement_mode in ('any', 'all')),
  required_act_codes text[] not null,
  label_es text not null,
  created_at timestamptz not null default now(),
  unique (process_definition_id, trigger_code)
);

comment on table public.process_stage_act_requirements is
  'Piezas mínimas antes de registrar un hito (p. ej. notificación auto enviada).';
comment on column public.process_stage_act_requirements.requirement_mode is
  'any = al menos un acto de la lista; all = todos los actos listados.';

-- ---------------------------------------------------------------------------
-- case_documents: vínculo al acto procesal
-- ---------------------------------------------------------------------------

alter table public.case_documents
  add column if not exists act_code text,
  add column if not exists act_sequence smallint,
  add column if not exists party_entity text,
  add column if not exists source_channel text
    check (
      source_channel is null
      or source_channel in ('manual', 'correo', 'generado', 'sgde', 'radicacion')
    );

comment on column public.case_documents.act_code is
  'Código del acto procesal (case_act_types.code) cuando la pieza está tipada.';
comment on column public.case_documents.act_sequence is
  'Orden humano opcional (01, 02…) dentro del cuaderno.';
comment on column public.case_documents.party_entity is
  'Entidad accionada u otra parte cuando aplica (p. ej. respuesta Colpensiones).';
comment on column public.case_documents.source_channel is
  'Canal de ingreso: manual, correo, generado desde plantilla, SGDE, radicación.';

create index if not exists case_documents_case_act_idx
  on public.case_documents (case_id, act_code)
  where act_code is not null;

-- ---------------------------------------------------------------------------
-- Seed: tutela primera instancia
-- ---------------------------------------------------------------------------

insert into public.case_act_types (
  process_definition_id,
  code,
  label_es,
  suggested_filename,
  stage_code,
  responsible_role,
  sort_band,
  is_repeatable
)
select
  pd.id,
  v.code,
  v.label_es,
  v.suggested_filename,
  v.stage_code,
  v.responsible_role,
  v.sort_band,
  v.is_repeatable
from public.process_definitions pd
cross join (
  values
    ('correo_reparto', 'Correo oficina de reparto', 'CorreoReparto.pdf', 'RADICACION', 'secretaria', 1, false),
    ('escrito_tutela', 'Escrito de tutela / demanda', 'EscritoTutela.pdf', 'RADICACION', 'secretaria', 2, false),
    ('acta_reparto', 'Acta de reparto', 'ActaReparto.pdf', 'RADICACION', 'secretaria', 3, false),
    ('anexos_pruebas', 'Anexos y pruebas', 'AnexosPruebas.pdf', 'RADICACION', 'secretaria', 4, false),
    ('informe_ingreso', 'Informe de ingreso al despacho', 'InformeIngresoDespacho.pdf', 'RADICACION', 'secretaria', 5, false),
    ('auto_admite', 'Auto admisorio (PDF firmado)', 'AutoAdmiteTutela.pdf', 'ADMISION', 'despacho', 6, false),
    ('notificacion_admisorio', 'Notificación auto admisorio', 'NotificacionAutoAdmite.pdf', 'NOTIFICACION_AUTO_ADMISORIO', 'escribiente', 7, false),
    ('constancia_notificacion', 'Constancia de notificación', 'ConstanciaNotificacion.pdf', 'NOTIFICACION_AUTO_ADMISORIO', 'escribiente', 8, false),
    ('correo_contestacion', 'Correo de contestación (entrada)', 'CorreoContestacion.pdf', 'TERMINO_RESPUESTA', 'escribiente', 9, true),
    ('respuesta_accionado', 'Respuesta entidad accionada', 'RespuestaAccionado.pdf', 'TERMINO_RESPUESTA', 'escribiente', 10, true),
    ('auto_amplia_termino', 'Auto amplía término', 'AutoAmpliaTermino.pdf', 'TERMINO_RESPUESTA', 'despacho', 11, false),
    ('auto_requiere', 'Auto de requerimiento', 'AutoRequiere.pdf', 'TERMINO_RESPUESTA', 'despacho', 12, false),
    ('fallo_tutela', 'Fallo de tutela (PDF firmado)', 'FalloTutela.pdf', 'FALLO', 'despacho', 20, false),
    ('notificacion_fallo', 'Notificación del fallo', 'NotificacionFallo.pdf', 'NOTIFICACION_FALLO', 'escribiente', 21, false),
    ('constancia_notificacion_fallo', 'Constancia notificación fallo', 'ConstanciaNotifFallo.pdf', 'NOTIFICACION_FALLO', 'escribiente', 22, false),
    ('remision_corte', 'Remisión a la Corte Constitucional', 'RemisionCorte.pdf', 'REMISION_CORTE', 'oficial_mayor', 30, false)
) as v(code, label_es, suggested_filename, stage_code, responsible_role, sort_band, is_repeatable)
where pd.legacy_case_type = 'tutela_primera'
on conflict (process_definition_id, code) do update
set
  label_es = excluded.label_es,
  suggested_filename = excluded.suggested_filename,
  stage_code = excluded.stage_code,
  responsible_role = excluded.responsible_role,
  sort_band = excluded.sort_band,
  is_repeatable = excluded.is_repeatable;

insert into public.process_stage_act_requirements (
  process_definition_id,
  trigger_code,
  requirement_mode,
  required_act_codes,
  label_es
)
select
  pd.id,
  v.trigger_code,
  v.requirement_mode,
  v.required_act_codes,
  v.label_es
from public.process_definitions pd
cross join (
  values
    (
      'SECRETARIA_NOTIFICACION_AUTO_ENVIADA',
      'any',
      array['notificacion_admisorio', 'constancia_notificacion']::text[],
      'Notificación auto admisorio enviada'
    ),
    (
      'SECRETARIA_NOTIFICACION_FALLO_ENVIADA',
      'any',
      array['notificacion_fallo', 'constancia_notificacion_fallo']::text[],
      'Notificación del fallo enviada'
    )
) as v(trigger_code, requirement_mode, required_act_codes, label_es)
where pd.legacy_case_type = 'tutela_primera'
on conflict (process_definition_id, trigger_code) do update
set
  requirement_mode = excluded.requirement_mode,
  required_act_codes = excluded.required_act_codes,
  label_es = excluded.label_es;

-- Backfill act_code en piezas existentes (heurística conservadora)
update public.case_documents d
set
  act_code = case
    when d.type = 'email_body' or d.name ilike 'CorreoReparto%' then 'correo_reparto'
    when d.type = 'informe_ingreso_expediente' or d.name ilike 'InformeIngreso%' then 'informe_ingreso'
    else d.act_code
  end,
  source_channel = coalesce(d.source_channel, case when d.type = 'email_body' then 'correo' else 'radicacion' end)
where d.act_code is null
  and (
    d.type in ('email_body', 'informe_ingreso_expediente')
    or d.name ilike 'CorreoReparto%'
    or d.name ilike 'InformeIngreso%'
  );

-- ---------------------------------------------------------------------------
-- RLS: catálogo lectura authenticated
-- ---------------------------------------------------------------------------

alter table public.case_act_types enable row level security;
alter table public.process_stage_act_requirements enable row level security;

drop policy if exists case_act_types_select on public.case_act_types;
create policy case_act_types_select on public.case_act_types
  for select to authenticated using (true);

drop policy if exists process_stage_act_requirements_select on public.process_stage_act_requirements;
create policy process_stage_act_requirements_select on public.process_stage_act_requirements
  for select to authenticated using (true);
