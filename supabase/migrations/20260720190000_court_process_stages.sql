-- Etapas personalizables por juzgado (override sobre process_stages_definition).
-- MVP lineal 1A/2A: rename / reorder / hide / CUSTOM_*; automatismos siguen en códigos canónicos.

create table if not exists public.court_process_stages (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete cascade,
  process_definition_id uuid not null references public.process_definitions (id) on delete cascade,
  stage_code text not null
    check (stage_code ~ '^[A-Z0-9_]+$'),
  label text not null,
  order_index int not null,
  is_hidden boolean not null default false,
  is_custom boolean not null default false,
  source_stage_definition_id uuid references public.process_stages_definition (id) on delete set null,
  responsible_role text
    check (responsible_role is null or responsible_role in ('secretaria', 'despacho')),
  term_days int,
  term_type text not null default 'none'
    check (term_type in ('habiles', 'calendario', 'none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (court_id, process_definition_id, stage_code),
  unique (court_id, process_definition_id, order_index)
);

comment on table public.court_process_stages is
  'Override por despacho del carril de etapas. Si no hay filas, el runtime usa process_stages_definition.';
comment on column public.court_process_stages.is_custom is
  'True si la etapa la creó el juzgado (CUSTOM_*); sin automatismo de case-stages-service.';
comment on column public.court_process_stages.is_hidden is
  'Oculta en UI de avance/skip; no elimina el código de plantilla (historial case_stages).';

create index if not exists court_process_stages_court_def_idx
  on public.court_process_stages (court_id, process_definition_id);

create index if not exists court_process_stages_def_idx
  on public.court_process_stages (process_definition_id);

alter table public.court_process_stages enable row level security;

select public.apply_court_rls_policies ('court_process_stages');

grant select, insert, update, delete on public.court_process_stages to authenticated;
