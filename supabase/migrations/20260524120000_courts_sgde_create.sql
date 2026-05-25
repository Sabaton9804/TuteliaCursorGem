-- Contenedor SGDE del despacho y opciones de creación al radicar (Fase B).

alter table public.courts
  add column if not exists sgde_parent_node_id text,
  add column if not exists sgde_auto_create_on_radicacion boolean not null default true,
  add column if not exists sgde_upload_docs_on_create boolean not null default true;

comment on column public.courts.sgde_parent_node_id is
  'UUID Alfresco de la carpeta contenedora de expedientes del despacho en SGDE.';
comment on column public.courts.sgde_auto_create_on_radicacion is
  'Si true, tras radicar tutela de primera instancia se intenta crear el expediente en SGDE.';
comment on column public.courts.sgde_upload_docs_on_create is
  'Si true, al crear en SGDE se suben PDF del cuaderno principal desde Tutelia Storage.';
