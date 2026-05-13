-- Consulta de desacato: texto libre sobre la decisión o conducta consultada (expediente en cases).
alter table public.cases
  add column if not exists conduct_description text;

comment on column public.cases.conduct_description is 'Consulta de desacato: descripción de la decisión o acto objeto de consulta.';
