-- Tutelia: reemplazo del modelo Firestore (courts / cases / documents / actions)
-- Ejecutar en Supabase SQL Editor o con: supabase db push

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.courts (
  id text primary key,
  name text not null default '',
  email text not null default '',
  city text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text not null default '',
  role text not null default 'admin',
  court_id text not null references public.courts (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete restrict,
  radicado text not null,
  claimant text not null,
  defendant text not null,
  status text not null,
  subject text,
  source_channel text,
  raw_text text,
  raw_html text,
  summary text,
  claimant_id text,
  claimant_email text,
  defendant_id text,
  defendant_email text,
  legal_hechos text,
  legal_pretensiones text,
  legal_derecho_tutelado text,
  legal_identificaciones text,
  email_metadata jsonb,
  operational_status text,
  assigned_to text,
  deadline_at timestamptz,
  sgde_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (court_id, radicado)
);

create index if not exists cases_court_updated_idx on public.cases (court_id, updated_at desc);

create table if not exists public.case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  name text not null,
  original_name text,
  type text not null,
  content_type text,
  content text,
  size bigint,
  is_from_link boolean not null default false,
  sort_order int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists case_documents_case_order_idx on public.case_documents (case_id, sort_order);

create table if not exists public.case_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  type text not null,
  description text,
  user_id uuid references auth.users (id) on delete set null,
  user_name text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists case_actions_case_created_idx on public.case_actions (case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Datos mínimos
-- ---------------------------------------------------------------------------

insert into public.courts (id, name, email, city)
values (
  'court-1',
  'Juzgado Civil del Circuito 01 de Bogotá',
  'j01ccbog@notificaciones.jud.co',
  'Bogotá'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS (equivalente a Firestore: solo usuarios autenticados, incl. anónimos)
-- ---------------------------------------------------------------------------

alter table public.courts enable row level security;
alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.case_documents enable row level security;
alter table public.case_actions enable row level security;

create policy courts_authenticated_all
  on public.courts for all
  to authenticated
  using (true) with check (true);

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy cases_authenticated_all
  on public.cases for all
  to authenticated
  using (true) with check (true);

create policy case_documents_authenticated_all
  on public.case_documents for all
  to authenticated
  using (true) with check (true);

create policy case_actions_authenticated_all
  on public.case_actions for all
  to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Perfil al registrarse (Google / anónimo / email)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, court_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, 'usuario'), '@', 1),
      'Funcionario'
    ),
    'admin',
    'court-1'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

-- Realtime: en Supabase → Database → Publications → supabase_realtime,
-- añada las tablas cases, case_documents y case_actions si desea suscripciones en vivo.
