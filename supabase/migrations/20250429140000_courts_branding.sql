-- Membrete compartido por despacho (textos + escudo data URL opcional) — visible para todo el equipo.

alter table public.courts
  add column if not exists branding jsonb;

comment on column public.courts.branding is
  'JSON: { "auto": {line1,line2,line3}, "informe": {juzgado,direccion,correo}, "membreteImageDataUrl": string opcional }.';
