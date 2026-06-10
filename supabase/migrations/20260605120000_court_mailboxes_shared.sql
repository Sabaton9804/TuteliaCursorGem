-- v0.4: buzones compartidos por despacho, membresía M:N y contexto Outlook.

-- ---------------------------------------------------------------------------
-- Buzones M365 por despacho
-- ---------------------------------------------------------------------------
create table if not exists public.court_mailboxes (
  id uuid primary key default gen_random_uuid(),
  court_id text not null references public.courts (id) on delete cascade,
  mailbox_upn text not null,
  display_name text not null default '',
  is_primary boolean not null default false,
  is_active boolean not null default true,
  mailbox_kind text not null default 'shared'
    check (mailbox_kind in ('shared', 'user', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (court_id, mailbox_upn)
);

create unique index if not exists court_mailboxes_one_primary_per_court
  on public.court_mailboxes (court_id)
  where is_primary = true and is_active = true;

create index if not exists court_mailboxes_court_active_idx
  on public.court_mailboxes (court_id)
  where is_active = true;

comment on table public.court_mailboxes is
  'Buzones Microsoft 365 del despacho (compartidos). mailbox_upn es el segmento /users/{upn} en Graph.';

-- ---------------------------------------------------------------------------
-- Membresía usuario ↔ despacho
-- ---------------------------------------------------------------------------
create table if not exists public.profile_court_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  court_id text not null references public.courts (id) on delete cascade,
  role text not null default 'clerk'
    check (role in (
      'admin', 'judge', 'clerk', 'official', 'sustanciador', 'escribiente', 'asistente_judicial'
    )),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, court_id)
);

create unique index if not exists profile_court_memberships_one_default
  on public.profile_court_memberships (profile_id)
  where is_default = true;

comment on table public.profile_court_memberships is
  'Despachos a los que pertenece un funcionario (rotación, múltiples juzgados).';

insert into public.profile_court_memberships (profile_id, court_id, role, is_default)
select p.id, p.court_id, p.role, true
from public.profiles p
on conflict (profile_id, court_id) do nothing;

-- ---------------------------------------------------------------------------
-- Contexto Graph en conexión OAuth (por funcionario)
-- ---------------------------------------------------------------------------
alter table public.outlook_connections
  add column if not exists graph_mode text not null default 'legacy_me'
    check (graph_mode in ('legacy_me', 'shared_mailbox')),
  add column if not exists active_court_id text references public.courts (id) on delete set null,
  add column if not exists active_mailbox_id uuid references public.court_mailboxes (id) on delete set null;

-- Conexiones existentes: modo legado /me hasta elegir buzón compartido
update public.outlook_connections
set graph_mode = 'legacy_me'
where graph_mode is null;

comment on column public.outlook_connections.mailbox_email is
  'Cuenta con la que el funcionario autorizó OAuth (UPN personal), no el buzón compartido del despacho.';
comment on column public.outlook_connections.graph_mode is
  'legacy_me = /me; shared_mailbox = /users/{mailbox_upn}/...';
comment on column public.outlook_connections.active_mailbox_id is
  'Buzón del despacho activo en el módulo de correo (court_mailboxes.id).';

-- ---------------------------------------------------------------------------
-- Helpers RLS
-- ---------------------------------------------------------------------------
create or replace function public.auth_user_has_court (p_court_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_is_superuser()
    or exists (
      select 1 from public.profile_court_memberships m
      where m.profile_id = auth.uid() and m.court_id = p_court_id
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.court_id = p_court_id
    );
$$;

comment on function public.auth_user_has_court (text) is
  'True si el usuario autenticado pertenece al despacho (membresía, perfil legacy o superuser).';

-- court_mailboxes
alter table public.court_mailboxes enable row level security;

create policy court_mailboxes_select_member on public.court_mailboxes
  for select to authenticated using (
    public.auth_user_has_court (court_id)
  );

-- profile_court_memberships
alter table public.profile_court_memberships enable row level security;

create policy profile_court_memberships_select_own on public.profile_court_memberships
  for select to authenticated using (profile_id = auth.uid());

-- outlook_message_reviews: políticas por membresía
drop policy if exists outlook_message_reviews_select_same_court on public.outlook_message_reviews;
drop policy if exists outlook_message_reviews_insert_same_court on public.outlook_message_reviews;
drop policy if exists outlook_message_reviews_update_same_court on public.outlook_message_reviews;

create policy outlook_message_reviews_select_same_court on public.outlook_message_reviews
  for select to authenticated using (
    public.auth_user_has_court (court_id)
  );

create policy outlook_message_reviews_insert_same_court on public.outlook_message_reviews
  for insert to authenticated with check (
    public.auth_user_has_court (court_id)
  );

create policy outlook_message_reviews_update_same_court on public.outlook_message_reviews
  for update to authenticated using (
    public.auth_user_has_court (court_id)
  ) with check (
    public.auth_user_has_court (court_id)
  );
