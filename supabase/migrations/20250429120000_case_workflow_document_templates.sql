-- Flujo despacho: informe de ingreso registrado en BD + catálogo de plantillas por despacho

alter table public.cases
  add column if not exists informe_ingreso_registrado_at timestamptz;

comment on column public.cases.informe_ingreso_registrado_at is
  'Cuándo secretaría marcó el informe de ingreso como elaborado; habilita auto admisorio en UI.';

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete cascade,
  categoria text not null check (categoria in ('despacho', 'secretaria')),
  tipo text not null check (tipo in ('informe_ingreso', 'auto_admisorio', 'libre')),
  nombre text not null,
  descripcion text,
  /** Texto con marcadores {{VARIABLE}}; si es null se usa el borrador por defecto del sistema */
  contenido_base text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_templates_court_sort_idx
  on public.document_templates (court_id, sort_order asc, nombre asc);

alter table public.document_templates enable row level security;

drop policy if exists document_templates_authenticated_all on public.document_templates;

create policy document_templates_authenticated_all
  on public.document_templates for all
  to authenticated
  using (true) with check (true);

insert into public.document_templates (id, court_id, categoria, tipo, nombre, descripcion, sort_order)
values (
    'a1000001-0001-4001-8001-000000000001'::uuid,
    'court-1',
    'secretaria',
    'informe_ingreso',
    'Informe de ingreso al despacho',
    'Trámite posterior a la radicación; contenido por defecto del sistema si contenido_base es null.',
    0
  ),
  (
    'a1000001-0001-4001-8001-000000000002'::uuid,
    'court-1',
    'despacho',
    'auto_admisorio',
    'Auto admisorio — tutela',
    'Admisión y traslados; contenido por defecto del sistema si contenido_base es null.',
    1
  )
on conflict (id) do nothing;
