-- Plantillas secretaría: oficios de notificación (auto admisorio y fallo).

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
    'a1000001-0001-4001-8001-000000000003'::uuid,
    'court-1',
    'secretaria',
    'notificacion_admisorio',
    'Oficio notificación auto admisorio',
    'Notificación a accionados del auto que admite la tutela.',
    20,
    null
  ),
  (
    'a1000001-0001-4001-8001-000000000004'::uuid,
    'court-1',
    'secretaria',
    'notificacion_fallo',
    'Oficio notificación fallo',
    'Notificación del fallo de tutela a las partes.',
    21,
    null
  )
on conflict (id) do update
set
  categoria = excluded.categoria,
  tipo = excluded.tipo,
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  sort_order = excluded.sort_order;
