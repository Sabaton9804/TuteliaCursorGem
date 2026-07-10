-- Fase 2: relajar CHECK rígido de stage_code en case_stages.
-- Los códigos válidos pasan a definirse en process_stages_definition;
-- stage_definition_id es la FK opcional de trazabilidad.

alter table public.case_stages
  drop constraint if exists case_stages_stage_code_check;

alter table public.case_stages
  add constraint case_stages_stage_code_format_check
  check (
    stage_code ~ '^[A-Z0-9_]+$'
    and char_length(stage_code) between 2 and 64
  );

comment on column public.case_stages.stage_code is
  'Código operativo de etapa (CaseStageCode). Validación por formato; definición canónica en process_stages_definition.';

-- Backfill stage_definition_id en filas abiertas/cerradas donde haya match por case_type del expediente.
update public.case_stages cs
set stage_definition_id = psd.id
from public.cases c
join public.process_definitions pd on pd.id = c.process_definition_id
join public.process_stages_definition psd
  on psd.process_definition_id = pd.id
where cs.case_id = c.id
  and psd.code = cs.stage_code
  and cs.stage_definition_id is null
  and c.process_definition_id is not null;
