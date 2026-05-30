-- Verificación manual: migraciones 20260526 + 20260527
-- Pegar en Supabase → SQL Editor → Run
-- Cada fila con ok = true indica que ese objeto existe.

SELECT check_name, ok
FROM (
  SELECT 'profiles.is_superuser' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_superuser'
    ) AS ok
  UNION ALL
  SELECT 'function.auth_is_superuser',
    EXISTS (
      SELECT 1 FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'auth_is_superuser'
    )
  UNION ALL
  SELECT 'policy.cases_select_superuser',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'cases' AND policyname = 'cases_select_superuser'
    )
  UNION ALL
  SELECT 'case_documents.file_hash',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'case_documents' AND column_name = 'file_hash'
    )
  UNION ALL
  SELECT 'table.case_document_ai_analyses',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'case_document_ai_analyses'
    )
  UNION ALL
  SELECT 'index.case_document_ai_analyses_doc_uidx',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'case_document_ai_analyses'
        AND indexname = 'case_document_ai_analyses_doc_uidx'
    )
  UNION ALL
  SELECT 'trigger.case_document_ai_analyses_check_case_trg',
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'case_document_ai_analyses_check_case_trg'
        AND NOT tgisinternal
    )
  UNION ALL
  SELECT 'rls.case_document_ai_analyses',
    COALESCE((
      SELECT c.relrowsecurity
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'case_document_ai_analyses'
    ), false)
  UNION ALL
  SELECT 'policy.case_document_ai_analyses_select_same_court',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'case_document_ai_analyses'
        AND policyname = 'case_document_ai_analyses_select_same_court'
    )
) q
ORDER BY check_name;
