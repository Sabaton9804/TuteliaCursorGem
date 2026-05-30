-- Verificación: migración 20260530140000_sierju_catalog_phase_s1.sql
--
-- Requisito previo: 20260529120000_judicial_process_platform_phase1.sql aplicada.
-- Ejecutar la migración SIERJU S1 completa en Supabase → SQL Editor antes de validar conteos.

-- ---------------------------------------------------------------------------
-- 1) Comprobaciones estructurales
-- ---------------------------------------------------------------------------

SELECT check_name, ok
FROM (
  SELECT 'table.sierju_form_templates' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sierju_form_templates'
    ) AS ok
  UNION ALL
  SELECT 'table.sierju_sections',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sierju_sections'
    )
  UNION ALL
  SELECT 'table.sierju_process_classes',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sierju_process_classes'
    )
  UNION ALL
  SELECT 'table.sierju_movement_types',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sierju_movement_types'
    )
  UNION ALL
  SELECT 'table.process_definition_sierju_classes',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'process_definition_sierju_classes'
    )
  UNION ALL
  SELECT 'table.sierju_tyba_class_map',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sierju_tyba_class_map'
    )
  UNION ALL
  SELECT 'courts.sierju_form_template_code',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'courts' AND column_name = 'sierju_form_template_code'
    )
  UNION ALL
  SELECT 'cases.sierju_process_class_id',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'sierju_process_class_id'
    )
  UNION ALL
  SELECT 'cases.sierju_metadata',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'sierju_metadata'
    )
  UNION ALL
  SELECT 'function._sierju_seed_section_classes',
    EXISTS (
      SELECT 1 FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = '_sierju_seed_section_classes'
    )
) checks
ORDER BY check_name;

-- ---------------------------------------------------------------------------
-- 2) Conteos esperados del seed S1
-- ---------------------------------------------------------------------------

SELECT metric, actual, expected, actual = expected AS ok
FROM (
  SELECT 'form_templates' AS metric,
    (SELECT count(*)::int FROM public.sierju_form_templates) AS actual,
    2 AS expected
  UNION ALL
  SELECT 'sections',
    (SELECT count(*)::int FROM public.sierju_sections),
    26
  UNION ALL
  SELECT 'process_classes',
    (SELECT count(*)::int FROM public.sierju_process_classes),
    255
  UNION ALL
  SELECT 'movement_types',
    (SELECT count(*)::int FROM public.sierju_movement_types),
    61
  UNION ALL
  SELECT 'process_definition_links_tutela',
    (SELECT count(*)::int
     FROM public.process_definition_sierju_classes pdc
     INNER JOIN public.process_definitions pd ON pd.id = pdc.process_definition_id
     WHERE pd.code IN ('tutela_primera', 'tutela_segunda')),
    24
  UNION ALL
  SELECT 'process_definition_links_consulta',
    (SELECT count(*)::int
     FROM public.process_definition_sierju_classes pdc
     INNER JOIN public.process_definitions pd ON pd.id = pdc.process_definition_id
     WHERE pd.code = 'consulta_desacato'),
    12
) counts
ORDER BY metric;

-- ---------------------------------------------------------------------------
-- 3) Despacho piloto J051
-- ---------------------------------------------------------------------------

SELECT
  c.id,
  c.sierju_form_template_code,
  c.sierju_form_template_code = 'sierju_civil_circuito_2023_v4' AS ok
FROM public.courts c
WHERE c.id = 'court-1';

-- ---------------------------------------------------------------------------
-- 4) Muestra: sección tutelas + clases derechos fundamentales
-- ---------------------------------------------------------------------------

SELECT spc.code, spc.label, spc.sort_order
FROM public.sierju_process_classes spc
INNER JOIN public.sierju_sections ss ON ss.id = spc.section_id
WHERE ss.form_template_code = 'sierju_civil_circuito_2023_v4'
  AND ss.code = 'movimiento_tutelas'
ORDER BY spc.sort_order;
