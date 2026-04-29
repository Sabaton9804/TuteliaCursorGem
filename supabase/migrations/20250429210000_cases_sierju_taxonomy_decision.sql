-- SIERJU: clasificación del derecho tutelado (filas del formulario) y tipo de decisión al cerrar/fallar.
-- legal_derecho_tutelado sigue siendo texto libre (detalle / extracción IA).

alter table public.cases
  add column if not exists derecho_tutelado_code text;

alter table public.cases
  add column if not exists decision_type text;

alter table public.cases drop constraint if exists cases_derecho_tutelado_code_valid;

alter table public.cases
  add constraint cases_derecho_tutelado_code_valid
  check (
    derecho_tutelado_code is null
    or derecho_tutelado_code in (
      'SALUD',
      'SEGURIDAD_SOCIAL',
      'VIDA',
      'MINIMO_VITAL',
      'IGUALDAD',
      'EDUCACION',
      'DEBIDO_PROCESO',
      'DERECHO_DE_PETICION',
      'INFORMACION_PUBLICA',
      'CONTRA_PROVIDENCIAS_JUDICIALES',
      'MEDIO_AMBIENTE',
      'OTROS'
    )
  );

alter table public.cases drop constraint if exists cases_decision_type_valid;

alter table public.cases
  add constraint cases_decision_type_valid
  check (
    decision_type is null
    or decision_type in (
      'CONCEDE',
      'NIEGA',
      'IMPROCEDENTE',
      'HECHO_SUPERADO',
      'RECHAZA',
      'FALTA_COMPETENCIA',
      'RETIRO_VOLUNTARIO',
      'REMISION',
      'OTRAS'
    )
  );

comment on column public.cases.derecho_tutelado_code is 'Filas SIERJU «Movimiento de Tutelas»; complementa legal_derecho_tutelado (texto).';
comment on column public.cases.decision_type is 'Salida sustantiva al fallar/archivar; para estadística oficial.';
comment on column public.case_actions.created_at is 'Momento del evento; usar junto con type/metadata para inventarios históricos.';
