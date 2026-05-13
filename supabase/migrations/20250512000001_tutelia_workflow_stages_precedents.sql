-- Tutelia: tareas de flujo, agenda, etapas explícitas, precedentes (pgvector), variables de plantilla,
-- ampliación de cases (tipo de asunto / segunda instancia) e incident_desacato.
-- Multi-tenant: court_id NOT NULL en tablas nuevas; RLS por mismo despacho que public.profiles.
--
-- Requisito proyecto: extensión pgvector (Supabase → Database → Extensions → vector).
-- Si falla en local sin pgvector, comente la línea CREATE EXTENSION y la columna embedding en precedents.

-- ---------------------------------------------------------------------------
-- Extensión pgvector (embedding 1536)
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 1) workflow_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete restrict,
  case_id uuid not null references public.cases (id) on delete cascade,
  radicado text,
  title text not null,
  description text,
  assignee_id uuid not null references auth.users (id) on delete restrict,
  creator_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'escalated', 'archived')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  task_type text not null
    check (
      task_type in (
        'draft_auto',
        'review_judge',
        'generate_notifs',
        'draft_fallo',
        'review_corrections',
        'custom',
        'informe_ingreso',
        'notificacion_accionado',
        'remision_corte',
        'consulta_desacato'
      )
    ),
  document_id uuid references public.case_documents (id) on delete set null,
  deadline timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists workflow_tasks_court_assignee_status_created_idx
  on public.workflow_tasks (court_id, assignee_id, status, created_at desc);

create index if not exists workflow_tasks_court_case_created_idx
  on public.workflow_tasks (court_id, case_id, created_at desc);

comment on table public.workflow_tasks is 'Cola de trabajo del flujo por expediente (multi-tenant).';

-- ---------------------------------------------------------------------------
-- 2) case_tasks (agenda)
-- ---------------------------------------------------------------------------
create table if not exists public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete restrict,
  case_id uuid not null references public.cases (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'curso', 'completada', 'vencida')),
  priority text not null default 'media'
    check (priority in ('alta', 'media', 'baja')),
  due_date timestamptz not null,
  assignee_id uuid not null references auth.users (id) on delete restrict,
  assignee_name text,
  context text not null default 'tutela'
    check (context in ('tutela', 'incidente')),
  incident_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists case_tasks_court_assignee_due_idx
  on public.case_tasks (court_id, assignee_id, due_date asc);

create index if not exists case_tasks_court_case_due_idx
  on public.case_tasks (court_id, case_id, due_date asc);

comment on table public.case_tasks is 'Agenda / compromisos con fecha por expediente (multi-tenant). incident_id: opcional enlace a public.incident_desacato(id) cuando se añada FK en migración futura.';

-- ---------------------------------------------------------------------------
-- 3) case_stages (una etapa abierta por caso: exited_at IS NULL)
-- ---------------------------------------------------------------------------
create table if not exists public.case_stages (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete restrict,
  case_id uuid not null references public.cases (id) on delete cascade,
  stage_code text not null
    check (
      stage_code in (
        'RADICACION',
        'ADMISION',
        'INADMISION',
        'RECHAZO',
        'NOTIFICACION_AUTO_ADMISORIO',
        'TERMINO_RESPUESTA',
        'INGRESO_DESPACHO_FALLO',
        'FALLO',
        'NOTIFICACION_FALLO',
        'TERMINO_IMPUGNACION',
        'IMPUGNACION',
        'REMISION_SUPERIOR',
        'EJECUTORIA',
        'REMISION_CORTE',
        'CUMPLIMIENTO',
        'INCIDENTE_DESACATO'
      )
    ),
  responsible_role text
    check (
      responsible_role is null
      or responsible_role in ('secretaria', 'despacho')
    ),
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  previous_stage_code text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists case_stages_one_open_per_case_idx
  on public.case_stages (case_id)
  where exited_at is null;

create index if not exists case_stages_court_case_entered_idx
  on public.case_stages (court_id, case_id, entered_at desc);

comment on table public.case_stages is 'Historial de etapas del trámite; etapa vigente: exited_at IS NULL (máx. una por caso).';

-- ---------------------------------------------------------------------------
-- 4) precedents (embedding opcional)
-- ---------------------------------------------------------------------------
create table if not exists public.precedents (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete restrict,
  source_case_id uuid references public.cases (id) on delete set null,
  radicado text not null,
  right_protected text not null,
  defendant text not null,
  ruling_sense text not null,
  legal_arguments text not null,
  summary text not null,
  decision_date date,
  tags jsonb not null default '[]'::jsonb,
  source_excerpt text,
  embedding extensions.vector (1536),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists precedents_court_created_idx
  on public.precedents (court_id, created_at desc);

comment on table public.precedents is 'Biblioteca de precedentes por despacho. embedding: dimensión 1536.';
comment on column public.precedents.embedding is 'Vector 1536 (pgvector). NULL hasta indexación.';

-- ---------------------------------------------------------------------------
-- 5) template_variables
-- ---------------------------------------------------------------------------
create table if not exists public.template_variables (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete restrict,
  document_template_id uuid not null references public.document_templates (id) on delete cascade,
  var_key text not null,
  label text not null,
  var_type text not null
    check (var_type in ('text', 'date', 'select', 'longtext')),
  required boolean not null default false,
  options jsonb,
  default_value text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_template_id, var_key)
);

create index if not exists template_variables_court_template_sort_idx
  on public.template_variables (court_id, document_template_id, sort_order, label);

comment on table public.template_variables is 'Variables tipadas por plantilla documental (multi-tenant).';

-- ---------------------------------------------------------------------------
-- Triggers: coherencia court_id
-- ---------------------------------------------------------------------------
create or replace function public.enforce_workflow_tasks_court_and_document ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court text;
begin
  select c.court_id into v_court from public.cases c where c.id = NEW.case_id;
  if v_court is null then
    raise exception 'workflow_tasks: case_id % no existe', NEW.case_id;
  end if;
  if NEW.court_id is distinct from v_court then
    raise exception 'workflow_tasks: court_id debe coincidir con cases.court_id del expediente';
  end if;
  if NEW.document_id is not null then
    if not exists (
      select 1
      from public.case_documents d
      where d.id = NEW.document_id
        and d.case_id = NEW.case_id
    ) then
      raise exception 'workflow_tasks: document_id debe pertenecer al mismo case_id';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists workflow_tasks_court_trg on public.workflow_tasks;
create trigger workflow_tasks_court_trg
  before insert or update on public.workflow_tasks
  for each row execute function public.enforce_workflow_tasks_court_and_document ();

create or replace function public.enforce_case_tasks_court ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court text;
begin
  select c.court_id into v_court from public.cases c where c.id = NEW.case_id;
  if v_court is null then
    raise exception 'case_tasks: case_id % no existe', NEW.case_id;
  end if;
  if NEW.court_id is distinct from v_court then
    raise exception 'case_tasks: court_id debe coincidir con cases.court_id del expediente';
  end if;
  return NEW;
end;
$$;

drop trigger if exists case_tasks_court_trg on public.case_tasks;
create trigger case_tasks_court_trg
  before insert or update on public.case_tasks
  for each row execute function public.enforce_case_tasks_court ();

create or replace function public.enforce_case_stages_court ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court text;
begin
  select c.court_id into v_court from public.cases c where c.id = NEW.case_id;
  if v_court is null then
    raise exception 'case_stages: case_id % no existe', NEW.case_id;
  end if;
  if NEW.court_id is distinct from v_court then
    raise exception 'case_stages: court_id debe coincidir con cases.court_id del expediente';
  end if;
  return NEW;
end;
$$;

drop trigger if exists case_stages_court_trg on public.case_stages;
create trigger case_stages_court_trg
  before insert or update on public.case_stages
  for each row execute function public.enforce_case_stages_court ();

create or replace function public.enforce_precedents_court ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court text;
begin
  if NEW.source_case_id is null then
    return NEW;
  end if;
  select c.court_id into v_court from public.cases c where c.id = NEW.source_case_id;
  if v_court is null then
    raise exception 'precedents: source_case_id % no existe', NEW.source_case_id;
  end if;
  if NEW.court_id is distinct from v_court then
    raise exception 'precedents: court_id debe coincidir con cases.court_id del expediente origen';
  end if;
  return NEW;
end;
$$;

drop trigger if exists precedents_court_trg on public.precedents;
create trigger precedents_court_trg
  before insert or update on public.precedents
  for each row execute function public.enforce_precedents_court ();

create or replace function public.enforce_template_variables_court ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court text;
begin
  select t.court_id into v_court from public.document_templates t where t.id = NEW.document_template_id;
  if v_court is null then
    raise exception 'template_variables: document_template_id % no existe', NEW.document_template_id;
  end if;
  if NEW.court_id is distinct from v_court then
    raise exception 'template_variables: court_id debe coincidir con document_templates.court_id';
  end if;
  return NEW;
end;
$$;

drop trigger if exists template_variables_court_trg on public.template_variables;
create trigger template_variables_court_trg
  before insert or update on public.template_variables
  for each row execute function public.enforce_template_variables_court ();

-- ---------------------------------------------------------------------------
-- RLS: mismo despacho que el perfil autenticado
-- ---------------------------------------------------------------------------
alter table public.workflow_tasks enable row level security;
alter table public.case_tasks enable row level security;
alter table public.case_stages enable row level security;
alter table public.precedents enable row level security;
alter table public.template_variables enable row level security;

create policy workflow_tasks_select_same_court on public.workflow_tasks for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = workflow_tasks.court_id)
);
create policy workflow_tasks_insert_same_court on public.workflow_tasks for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = workflow_tasks.court_id)
);
create policy workflow_tasks_update_same_court on public.workflow_tasks for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = workflow_tasks.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = workflow_tasks.court_id)
);
create policy workflow_tasks_delete_same_court on public.workflow_tasks for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = workflow_tasks.court_id)
);

create policy case_tasks_select_same_court on public.case_tasks for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_tasks.court_id)
);
create policy case_tasks_insert_same_court on public.case_tasks for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_tasks.court_id)
);
create policy case_tasks_update_same_court on public.case_tasks for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_tasks.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_tasks.court_id)
);
create policy case_tasks_delete_same_court on public.case_tasks for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_tasks.court_id)
);

create policy case_stages_select_same_court on public.case_stages for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_stages.court_id)
);
create policy case_stages_insert_same_court on public.case_stages for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_stages.court_id)
);
create policy case_stages_update_same_court on public.case_stages for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_stages.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_stages.court_id)
);
create policy case_stages_delete_same_court on public.case_stages for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = case_stages.court_id)
);

create policy precedents_select_same_court on public.precedents for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedents.court_id)
);
create policy precedents_insert_same_court on public.precedents for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedents.court_id)
);
create policy precedents_update_same_court on public.precedents for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedents.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedents.court_id)
);
create policy precedents_delete_same_court on public.precedents for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = precedents.court_id)
);

create policy template_variables_select_same_court on public.template_variables for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = template_variables.court_id)
);
create policy template_variables_insert_same_court on public.template_variables for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = template_variables.court_id)
);
create policy template_variables_update_same_court on public.template_variables for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = template_variables.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = template_variables.court_id)
);
create policy template_variables_delete_same_court on public.template_variables for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = template_variables.court_id)
);

-- ---------------------------------------------------------------------------
-- 6) cases: tipo de asunto e información de segunda instancia / origen
-- ---------------------------------------------------------------------------
alter table public.cases
  add column if not exists case_type text not null default 'tutela_primera'
    check (case_type in ('tutela_primera', 'tutela_segunda', 'consulta_desacato')),
  add column if not exists origin_court text,
  add column if not exists origin_radicado text,
  add column if not exists appellant text
    check (appellant is null or appellant in ('accionante', 'accionado')),
  add column if not exists origin_ruling text
    check (origin_ruling is null or origin_ruling in ('concedio', 'nego'));

comment on column public.cases.case_type is 'Clasificación del expediente: primera o segunda instancia, o consulta de desacato.';
comment on column public.cases.origin_court is 'Juzgado de origen (p. ej. primera instancia al tramitar segunda).';
comment on column public.cases.origin_radicado is 'Radicado de origen en primera instancia u otro proceso vinculado.';
comment on column public.cases.appellant is 'Quién interpone recurso/segunda instancia cuando aplica.';
comment on column public.cases.origin_ruling is 'Sentido del fallo de origen (concedió / negó), sin tilde según CHECK acordado.';

-- ---------------------------------------------------------------------------
-- 7) incident_desacato (incidente de desacato ligado al expediente padre)
-- ---------------------------------------------------------------------------
create table if not exists public.incident_desacato (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete restrict,
  parent_case_id uuid not null references public.cases (id) on delete cascade,
  requested_by text not null
    check (requested_by in ('accionante', 'interviniente', 'ministerio_publico', 'defensoria')),
  requester_name text not null,
  request_date timestamptz not null,
  conduct_description text not null,
  status text not null default 'activo'
    check (status in ('activo', 'sancionado', 'cumplimiento_acreditado', 'archivado')),
  sanction_arrest_months int,
  sanction_fine_smmlv int,
  consulta_sent_at timestamptz,
  consulta_result text
    check (consulta_result is null or consulta_result in ('confirma', 'revoca')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incident_desacato_court_case_idx
  on public.incident_desacato (court_id, parent_case_id);

comment on table public.incident_desacato is 'Incidente de desacato vinculado a expediente padre (multi-tenant).';

create or replace function public.enforce_incident_desacato_court ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court text;
begin
  select c.court_id into v_court from public.cases c where c.id = NEW.parent_case_id;
  if v_court is null then
    raise exception 'incident_desacato: parent_case_id no existe';
  end if;
  if NEW.court_id is distinct from v_court then
    raise exception 'incident_desacato: court_id debe coincidir con cases.court_id del expediente padre';
  end if;
  return NEW;
end;
$$;

drop trigger if exists incident_desacato_court_trg on public.incident_desacato;
create trigger incident_desacato_court_trg
  before insert or update on public.incident_desacato
  for each row execute function public.enforce_incident_desacato_court ();

alter table public.incident_desacato enable row level security;

create policy incident_desacato_select_same_court on public.incident_desacato for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = incident_desacato.court_id)
);

create policy incident_desacato_insert_same_court on public.incident_desacato for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = incident_desacato.court_id)
);

create policy incident_desacato_update_same_court on public.incident_desacato for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = incident_desacato.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = incident_desacato.court_id)
);

create policy incident_desacato_delete_same_court on public.incident_desacato for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = incident_desacato.court_id)
);

-- Opcional: publicar tablas en supabase_realtime; FK case_tasks.incident_id → incident_desacato(id) en migración futura.
