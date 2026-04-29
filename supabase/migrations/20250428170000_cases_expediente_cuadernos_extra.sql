-- Cuadernos de incidente u otros: solo los que el usuario declara o que ya tienen piezas.

alter table public.cases
  add column if not exists expediente_cuadernos_extra jsonb not null default '[]'::jsonb;

comment on column public.cases.expediente_cuadernos_extra is
  'Lista de cuadernos adicionales: [{"code":"PI_INC_...","label":"Incidente de desacato"}, ...]. El C01 principal no se repite aquí.';
