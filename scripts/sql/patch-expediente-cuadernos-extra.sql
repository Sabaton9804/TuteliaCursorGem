-- Parche idempotente: columna para cuadernos adicionales del expediente digital.
-- Ejecutar en Supabase → SQL Editor si aparece PGRST204 / expediente_cuadernos_extra.

alter table public.cases
  add column if not exists expediente_cuadernos_extra jsonb not null default '[]'::jsonb;

comment on column public.cases.expediente_cuadernos_extra is
  'Lista de cuadernos adicionales: [{"code":"PI_INC_...","label":"Incidente de desacato"}, ...].';

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'cases'
  and column_name = 'expediente_cuadernos_extra';
