-- Ramas INADMISION / RECHAZO en grafo de transiciones (tutela 1ª y civiles CGP).
-- Runtime cierra en EJECUTORIA + cases.status = archived.

insert into public.process_stage_transitions (process_definition_id, from_stage_code, to_stage_code, label, is_default)
select pd.id, t.from_code, t.to_code, t.lbl, t.is_def
from public.process_definitions pd
cross join (
  values
    ('TERMINO_RESPUESTA', 'TRAMITE', 'Trámite probatorio (CGP)', false),
    ('TRAMITE', 'INGRESO_DESPACHO_FALLO', 'Ingreso al despacho para sentencia', false),
    ('RADICACION', 'RECHAZO', 'Rechazo de demanda', false),
    ('ADMISION', 'INADMISION', 'Inadmisión', false),
    ('INADMISION', 'EJECUTORIA', 'Archivo por inadmisión', false),
    ('RECHAZO', 'EJECUTORIA', 'Archivo por rechazo', false)
) as t (from_code, to_code, lbl, is_def)
where pd.code in (
  'tutela_primera',
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, from_stage_code, to_stage_code) do nothing;

-- Etapas de rama en definición civil (no forman parte del carril lineal principal).
insert into public.process_stages_definition (
  process_definition_id, code, label, order_index, stage_kind,
  term_days, term_type, responsible_role, generates_alert, alert_threshold_pct,
  workflow_task_type
)
select pd.id, s.code, s.label, s.order_index, s.stage_kind,
  s.term_days, s.term_type, s.responsible_role, s.generates_alert, s.alert_threshold_pct,
  s.workflow_task_type
from public.process_definitions pd
cross join (
  values
    ('INADMISION', 'Inadmisión', 90, 'branch', null::int, 'none', 'despacho', false, 75, null::text),
    ('RECHAZO', 'Rechazo de demanda', 91, 'branch', null::int, 'none', 'despacho', false, 75, null::text)
) as s (code, label, order_index, stage_kind, term_days, term_type, responsible_role, generates_alert, alert_threshold_pct, workflow_task_type)
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, code) do nothing;
