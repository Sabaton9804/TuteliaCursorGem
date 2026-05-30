-- Verificación: migración 20260529120000_judicial_process_platform_phase1.sql
--
-- Si aún NO aplicó la migración, ejecute PRIMERO el archivo completo:
--   supabase/migrations/20260529120000_judicial_process_platform_phase1.sql
-- en Supabase → SQL Editor → Run.
--
-- Nota: cases.expediente_cuadernos_extra es de otra migración (20250428170000).
-- Si sale false, ejecute también scripts/sql/patch-expediente-cuadernos-extra.sql
--
-- Este script es seguro antes y después de la migración.
-- ---------------------------------------------------------------------------
-- 1) Comprobaciones estructurales (solo information_schema / pg_catalog)
-- ---------------------------------------------------------------------------

SELECT check_name, ok
FROM (
  SELECT 'table.judicial_territories' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'judicial_territories'
    ) AS ok
  UNION ALL
  SELECT 'table.process_definitions',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'process_definitions'
    )
  UNION ALL
  SELECT 'table.process_stages_definition',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'process_stages_definition'
    )
  UNION ALL
  SELECT 'table.court_enabled_processes',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'court_enabled_processes'
    )
  UNION ALL
  SELECT 'courts.dane_code',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'courts' AND column_name = 'dane_code'
    )
  UNION ALL
  SELECT 'cases.process_definition_id',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'process_definition_id'
    )
  UNION ALL
  SELECT 'cases.expediente_cuadernos_extra',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'expediente_cuadernos_extra'
    )
  UNION ALL
  SELECT 'function.court_radicacion_prefix',
    EXISTS (
      SELECT 1 FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'court_radicacion_prefix'
    )
) q
ORDER BY check_name;

-- ---------------------------------------------------------------------------
-- 2) Seeds y backfill (solo si la migración ya corrió)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_has_pd boolean;
  v_has_cep boolean;
  v_has_cui_col boolean;
  v_has_pdf_col boolean;
  v_stages_ok boolean := false;
  v_cui_ok boolean := false;
  v_enabled_ok boolean := false;
  v_con_def bigint := null;
  v_sin_def bigint := null;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'process_definitions'
  ) INTO v_has_pd;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'court_enabled_processes'
  ) INTO v_has_cep;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'courts' AND column_name = 'dane_code'
  ) INTO v_has_cui_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'process_definition_id'
  ) INTO v_has_pdf_col;

  IF NOT v_has_pd THEN
    RAISE NOTICE 'Migración NO aplicada: falta public.process_definitions.';
    RAISE NOTICE 'Ejecute supabase/migrations/20260529120000_judicial_process_platform_phase1.sql y vuelva a correr este script.';
    RETURN;
  END IF;

  EXECUTE $q$
    SELECT count(*) = 10
    FROM public.process_definitions pd
    INNER JOIN public.process_stages_definition psd ON psd.process_definition_id = pd.id
    WHERE pd.code = 'tutela_primera'
  $q$ INTO v_stages_ok;

  IF v_has_cui_col THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.courts
        WHERE id = 'court-1'
          AND dane_code = '11001'
          AND entity_code = '31'
          AND specialty_code = '03'
          AND despacho_number = '051'
      )
    $q$ INTO v_cui_ok;
  END IF;

  IF v_has_cep THEN
    EXECUTE $q$
      SELECT count(*) = 3
      FROM public.court_enabled_processes cep
      INNER JOIN public.process_definitions pd ON pd.id = cep.process_definition_id
      WHERE cep.court_id = 'court-1'
        AND pd.code IN ('tutela_primera', 'tutela_segunda', 'consulta_desacato')
    $q$ INTO v_enabled_ok;
  END IF;

  IF v_has_pdf_col THEN
    EXECUTE $q$
      SELECT
        count(*) FILTER (WHERE process_definition_id IS NOT NULL),
        count(*) FILTER (WHERE process_definition_id IS NULL)
      FROM public.cases
    $q$ INTO v_con_def, v_sin_def;
  END IF;

  RAISE NOTICE 'seed.tutela_primera_stages (10 etapas): %', CASE WHEN v_stages_ok THEN 'OK' ELSE 'FALTA' END;
  RAISE NOTICE 'seed.court1_cui (11001-31-03-051): %', CASE WHEN v_cui_ok THEN 'OK' ELSE 'FALTA' END;
  RAISE NOTICE 'seed.court1_enabled_processes (3 procesos): %', CASE WHEN v_enabled_ok THEN 'OK' ELSE 'FALTA' END;

  IF v_con_def IS NOT NULL THEN
    RAISE NOTICE 'cases con process_definition_id: % | sin definición: %', v_con_def, v_sin_def;
  END IF;
END $$;
