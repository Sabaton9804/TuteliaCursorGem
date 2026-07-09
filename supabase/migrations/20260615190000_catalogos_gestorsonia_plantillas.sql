-- Catálogo GestorSonia: plantillas secretaría para oficios generales (comunicaciones, comisión, requerimiento, competencia).

alter table public.document_templates
  drop constraint if exists document_templates_tipo_check;

alter table public.document_templates
  add constraint document_templates_tipo_check
  check (
    tipo in (
      'informe_ingreso',
      'auto_admisorio',
      'notificacion_admisorio',
      'notificacion_fallo',
      'oficio_juzgado',
      'oficio_comision',
      'oficio_requerimiento',
      'oficio_competencia',
      'libre'
    )
  );

insert into public.document_templates (
  id,
  court_id,
  categoria,
  tipo,
  nombre,
  descripcion,
  sort_order,
  contenido_base
)
values
  (
    'a1000001-0001-4001-8001-000000000005'::uuid,
    'court-1',
    'secretaria',
    'oficio_juzgado',
    'Oficio a otro juzgado',
    'Comunicación oficial entre despachos judiciales.',
    30,
    null
  ),
  (
    'a1000001-0001-4001-8001-000000000006'::uuid,
    'court-1',
    'secretaria',
    'oficio_comision',
    'Oficio comisión',
    'Encargo para diligencia o actuación procesal.',
    31,
    null
  ),
  (
    'a1000001-0001-4001-8001-000000000007'::uuid,
    'court-1',
    'secretaria',
    'oficio_requerimiento',
    'Oficio requerimiento',
    'Requerimiento con necesidad de respuesta formal.',
    32,
    null
  ),
  (
    'a1000001-0001-4001-8001-000000000008'::uuid,
    'court-1',
    'secretaria',
    'oficio_competencia',
    'Oficio competencia / devolución',
    'Rechazo, remisión o devolución por incompetencia.',
    33,
    null
  )
on conflict (id) do update
set
  categoria = excluded.categoria,
  tipo = excluded.tipo,
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  sort_order = excluded.sort_order;
