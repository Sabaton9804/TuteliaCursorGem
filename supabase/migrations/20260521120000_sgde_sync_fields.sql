-- Vínculo SGDE por documento y estado de sincronización (Fase A).

alter table public.cases
  add column if not exists sgde_linked_at timestamptz,
  add column if not exists sgde_sync_status text not null default 'idle';

alter table public.cases
  drop constraint if exists cases_sgde_sync_status_check;

alter table public.cases
  add constraint cases_sgde_sync_status_check
  check (sgde_sync_status in ('idle', 'linked', 'syncing', 'error', 'stale'));

comment on column public.cases.sgde_linked_at is 'Momento en que se guardó cases.sgde_id (vinculación con nodo rama:expedientes).';
comment on column public.cases.sgde_sync_status is 'Estado de sincronización con SGDE: idle, linked, syncing, error, stale.';

alter table public.case_documents
  add column if not exists sgde_id text,
  add column if not exists sgde_folder_path text,
  add column if not exists sgde_sync_status text not null default 'none';

alter table public.case_documents
  drop constraint if exists case_documents_sgde_sync_status_check;

alter table public.case_documents
  add constraint case_documents_sgde_sync_status_check
  check (sgde_sync_status in ('none', 'linked', 'local_only', 'sgde_only'));

comment on column public.case_documents.sgde_id is 'UUID del nodo rama:documentos en Alfresco SGDE.';
comment on column public.case_documents.sgde_folder_path is 'Ruta legible en SGDE (p. ej. Primera Instancia / 01CdoPrincipal).';
comment on column public.case_documents.sgde_sync_status is 'none | linked (Tutelia+SGDE) | local_only | sgde_only.';

create index if not exists case_documents_case_sgde_id_idx
  on public.case_documents (case_id)
  where sgde_id is not null;

-- Mapeo cuaderno Tutelia ↔ carpeta SGDE (opcional por expediente).
create table if not exists public.case_sgde_folder_map (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  notebook_code text not null,
  sgde_folder_node_id text not null,
  folder_path text,
  created_at timestamptz not null default now(),
  unique (case_id, notebook_code)
);

create index if not exists case_sgde_folder_map_court_case_idx
  on public.case_sgde_folder_map (court_id, case_id);

comment on table public.case_sgde_folder_map is
  'Enlace entre notebook_code (Tutelia) y carpeta SGDE (rama:carpeta).';

alter table public.case_sgde_folder_map enable row level security;

create policy case_sgde_folder_map_court_all
  on public.case_sgde_folder_map for all
  to authenticated
  using (
    court_id = (select court_id from public.profiles where id = auth.uid())
  )
  with check (
    court_id = (select court_id from public.profiles where id = auth.uid())
  );
