-- Tokens de Microsoft Graph por usuario (solo accesibles vía service_role en el servidor).
create table if not exists public.outlook_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  mailbox_email text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  scopes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outlook_connections enable row level security;

comment on table public.outlook_connections is
  'Conexión OAuth de Outlook/Microsoft 365 por funcionario. Lectura/escritura solo desde server.ts con service_role.';
