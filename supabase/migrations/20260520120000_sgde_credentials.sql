-- Credenciales SGDE por funcionario (cifradas; solo el servidor con service_role lee/escribe).

create table if not exists public.sgde_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  password_ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.sgde_credentials enable row level security;

comment on table public.sgde_credentials is
  'Usuario y contraseña SGDE del funcionario. password_ciphertext cifrado en servidor (AES-GCM). Sin políticas RLS: solo API con service_role.';

comment on column public.sgde_credentials.username is 'Usuario de login SGDE (correo o id Rama).';
comment on column public.sgde_credentials.password_ciphertext is 'Contraseña cifrada; formato v1:iv:tag:ciphertext (base64).';
