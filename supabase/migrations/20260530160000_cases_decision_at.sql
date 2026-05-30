-- Fecha del fallo/decisión para estadística SIERJU (no confundir con updated_at del expediente).

alter table public.cases
  add column if not exists decision_at timestamptz;

comment on column public.cases.decision_at is
  'Momento en que se registró la decisión sustantiva (decision_type). Para columnas de salida SIERJU.';

create index if not exists cases_decision_at_idx
  on public.cases (court_id, decision_at)
  where decision_at is not null;

-- Backfill conservador: expedientes que ya tenían decision_type
update public.cases
set decision_at = updated_at
where decision_type is not null
  and decision_at is null;
