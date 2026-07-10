-- Plantillas despacho: auto de trámite (frecuente) y sentencia (escasa).

alter table public.document_templates
  drop constraint if exists document_templates_tipo_check;

alter table public.document_templates
  add constraint document_templates_tipo_check
  check (
    tipo in (
      'informe_ingreso',
      'auto_admisorio',
      'auto_tramite',
      'sentencia',
      'notificacion_admisorio',
      'notificacion_fallo',
      'oficio_juzgado',
      'oficio_comision',
      'oficio_requerimiento',
      'oficio_competencia',
      'libre'
    )
  );

-- Semillas despacho: contenido_base null = cuerpo por defecto del sistema
-- (`cuerpoEditablePredeterminadoPlantilla` en plantilla-variables.ts).
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
    'a1000001-0001-4001-8001-000000000009'::uuid,
    'court-1',
    'despacho',
    'auto_tramite',
    'Auto de trámite',
    'Providencias ordinarias del proceso (decretos, traslados, requerimientos); contenido por defecto del sistema si contenido_base es null.',
    2,
    null
  ),
  (
    'a1000001-0001-4001-8001-000000000010'::uuid,
    'court-1',
    'despacho',
    'sentencia',
    'Sentencia',
    'Decisión de fondo (uso ocasional); mismo ciclo de revisión y PDF firmado que el fallo de tutela.',
    3,
    null
  )
on conflict (id) do update
set
  categoria = excluded.categoria,
  tipo = excluded.tipo,
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  sort_order = excluded.sort_order;
