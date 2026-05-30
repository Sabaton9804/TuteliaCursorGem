-- Ejecutar en Supabase SQL Editor si falta cases.decision_at (PGRST204).
-- Equivalente a supabase/migrations/20260530160000_cases_decision_at.sql

alter table public.cases
  add column if not exists decision_at timestamptz;

comment on column public.cases.decision_at is
  'Momento en que se registró la decisión sustantiva (decision_type). Para columnas de salida SIERJU.';

create index if not exists cases_decision_at_idx
  on public.cases (court_id, decision_at)
  where decision_at is not null;

update public.cases
set decision_at = updated_at
where decision_type is not null
  and decision_at is null;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'decision_at';
