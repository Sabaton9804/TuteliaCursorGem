-- Verificación: migración 20260530160000_cases_decision_at.sql

SELECT check_name, ok
FROM (
  SELECT 'cases.decision_at' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'decision_at'
    ) AS ok
  UNION ALL
  SELECT 'index.cases_decision_at_idx',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'cases_decision_at_idx'
    )
) checks
ORDER BY check_name;

SELECT
  count(*) FILTER (WHERE decision_type IS NOT NULL) AS con_decision_type,
  count(*) FILTER (WHERE decision_at IS NOT NULL) AS con_decision_at
FROM public.cases;
