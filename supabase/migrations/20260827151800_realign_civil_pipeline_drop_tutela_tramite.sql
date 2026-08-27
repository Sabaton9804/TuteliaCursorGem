-- F1: alinear carril civil con STAGE_PIPELINE_BY_CASE_TYPE (TS).
-- ADMISION/EJECUTORIA pasan a linear (el runtime ignora branch/terminal al armar el carril).
-- Apelación queda antes de ejecutoria; se añade REMISION_SUPERIOR en civiles no ejecutivos.
-- Quita TERMINO_RESPUESTA → TRAMITE de tutela_primera (contaminación del seed 20260709160000).

update public.process_stages_definition psd
set stage_kind = 'linear'
from public.process_definitions pd
where psd.process_definition_id = pd.id
  and pd.code in (
    'civil_ordinario',
    'civil_ejecutivo',
    'civil_jurisdiccion_voluntaria',
    'civil_insolvencia',
    'civil_otros'
  )
  and psd.code in ('ADMISION', 'EJECUTORIA');

-- Orden CGP ordinario (y buckets asimilados). Ejecutivo ya tiene 1–12 en 20260709200000.
update public.process_stages_definition psd
set order_index = v.ord
from public.process_definitions pd
join (
  values
    ('RADICACION', 1),
    ('ADMISION', 2),
    ('NOTIFICACION_AUTO_ADMISORIO', 3),
    ('TERMINO_RESPUESTA', 4),
    ('TRAMITE', 5),
    ('INGRESO_DESPACHO_FALLO', 6),
    ('FALLO', 7),
    ('NOTIFICACION_FALLO', 8),
    ('TERMINO_APELACION', 9),
    ('APELACION', 10),
    ('REMISION_SUPERIOR', 11),
    ('EJECUTORIA', 12)
) as v (code, ord) on v.code = psd.code
where psd.process_definition_id = pd.id
  and pd.code in (
    'civil_ordinario',
    'civil_jurisdiccion_voluntaria',
    'civil_insolvencia',
    'civil_otros'
  );

insert into public.process_stages_definition (
  process_definition_id, code, label, order_index, stage_kind,
  term_days, term_type, responsible_role, generates_alert, alert_threshold_pct,
  workflow_task_type
)
select pd.id, 'REMISION_SUPERIOR', 'Remisión al superior', 11, 'linear',
  null, 'none', 'secretaria', false, 75, null
from public.process_definitions pd
where pd.code in (
  'civil_ordinario',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, code) do update set
  label = excluded.label,
  order_index = excluded.order_index,
  stage_kind = 'linear';

insert into public.process_stage_transitions (
  process_definition_id, from_stage_code, to_stage_code, label, is_default
)
select pd.id, 'APELACION', 'REMISION_SUPERIOR', 'Remisión al superior', true
from public.process_definitions pd
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, from_stage_code, to_stage_code) do nothing;

delete from public.process_stage_transitions t
using public.process_definitions pd
where t.process_definition_id = pd.id
  and pd.code = 'tutela_primera'
  and t.from_stage_code = 'TERMINO_RESPUESTA'
  and t.to_stage_code = 'TRAMITE';

insert into public.case_act_types (
  process_definition_id, code, label_es, suggested_filename, stage_code, responsible_role, sort_band, is_repeatable
)
select pd.id, 'remision_superior', 'Remisión al superior', 'RemisionSuperior.pdf',
  'REMISION_SUPERIOR', 'secretaria', 24, false
from public.process_definitions pd
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, code) do nothing;

insert into public.process_stage_act_requirements (
  process_definition_id, trigger_code, requirement_mode, required_act_codes, label_es
)
select pd.id, 'SECRETARIA_REMISION_SUPERIOR', 'all', array['remision_superior'], 'Remisión al superior registrada'
from public.process_definitions pd
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, trigger_code) do nothing;
