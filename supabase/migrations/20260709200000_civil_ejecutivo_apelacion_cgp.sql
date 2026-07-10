-- Pipeline ejecutivo CGP + término de apelación civil (CGP art. 318) + excepciones (art. 443).

create or replace function public._seed_civil_ejecutivo_process_stages_cgp ()
returns void
language plpgsql
as $$
declare
  v_pid uuid;
begin
  select id into v_pid from public.process_definitions where code = 'civil_ejecutivo';
  if v_pid is null then
    raise exception 'process_definitions civil_ejecutivo no existe';
  end if;

  delete from public.process_stages_definition where process_definition_id = v_pid;

  insert into public.process_stages_definition (
    process_definition_id, code, label, order_index, stage_kind,
    term_days, term_type, responsible_role, generates_alert, alert_threshold_pct,
    workflow_task_type
  )
  values
    (v_pid, 'RADICACION', 'Radicación demanda ejecutiva', 1, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'ADMISION', 'Mandamiento de pago', 2, 'branch', null, 'none', 'despacho', true, 75, 'generate_notifs'),
    (v_pid, 'NOTIFICACION_AUTO_ADMISORIO', 'Notificación mandamiento de pago', 3, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'TERMINO_EXCEPCIONES', 'Excepciones de mérito (art. 443 CGP)', 4, 'linear', 5, 'habiles', 'secretaria', true, 75, null),
    (v_pid, 'TRAMITE', 'Trámite / medidas cautelares', 5, 'linear', null, 'none', 'despacho', false, 75, null),
    (v_pid, 'INGRESO_DESPACHO_FALLO', 'Ingreso despacho / sentencia', 6, 'linear', null, 'none', 'despacho', true, 75, null),
    (v_pid, 'FALLO', 'Sentencia / auto de ejecución', 7, 'linear', null, 'none', 'despacho', true, 75, 'generate_notifs'),
    (v_pid, 'NOTIFICACION_FALLO', 'Notificación sentencia', 8, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'TERMINO_APELACION', 'Apelación (art. 318 CGP)', 9, 'linear', 10, 'habiles', 'secretaria', true, 75, null),
    (v_pid, 'APELACION', 'Apelación recibida', 10, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'REMISION_SUPERIOR', 'Remisión al superior', 11, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'EJECUTORIA', 'Ejecutoria / archivo', 12, 'terminal', null, 'none', 'secretaria', false, 75, null);
end;
$$;

select public._seed_civil_ejecutivo_process_stages_cgp();
drop function if exists public._seed_civil_ejecutivo_process_stages_cgp ();

-- Etapas de apelación en civiles ordinarios (y otros buckets).
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
    ('TERMINO_APELACION', 'Apelación (art. 318 CGP)', 92, 'linear', 10, 'habiles', 'secretaria', true, 75, null::text),
    ('APELACION', 'Apelación recibida', 93, 'linear', null::int, 'none', 'secretaria', false, 75, null::text)
) as s (code, label, order_index, stage_kind, term_days, term_type, responsible_role, generates_alert, alert_threshold_pct, workflow_task_type)
where pd.code in (
  'civil_ordinario',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, code) do update set
  label = excluded.label,
  term_days = excluded.term_days,
  term_type = excluded.term_type;

insert into public.process_stage_transitions (process_definition_id, from_stage_code, to_stage_code, label, is_default)
select pd.id, t.from_code, t.to_code, t.lbl, t.is_def
from public.process_definitions pd
cross join (
  values
    ('NOTIFICACION_FALLO', 'TERMINO_APELACION', 'Inicia término de apelación', true),
    ('TERMINO_APELACION', 'EJECUTORIA', 'Ejecutoria (sin apelación)', false),
    ('TERMINO_APELACION', 'APELACION', 'Apelación recibida', false),
    ('APELACION', 'REMISION_SUPERIOR', 'Remisión al superior', true),
    ('TERMINO_EXCEPCIONES', 'TRAMITE', 'Trámite / medidas', false)
) as t (from_code, to_code, lbl, is_def)
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, from_stage_code, to_stage_code) do nothing;

-- Actos ejecutivo + apelación (ordinario ya sembrado en 20260709180000).
insert into public.case_act_types (
  process_definition_id, code, label_es, suggested_filename, stage_code, responsible_role, sort_band, is_repeatable
)
select pd.id, v.code, v.label_es, v.suggested_filename, v.stage_code, v.responsible_role, v.sort_band, v.is_repeatable
from public.process_definitions pd
cross join (
  values
    ('titulo_ejecutivo', 'Título ejecutivo', 'TituloEjecutivo.pdf', 'RADICACION', 'secretaria', 1, false),
    ('mandamiento_pago', 'Mandamiento de pago (PDF firmado)', 'MandamientoPago.pdf', 'ADMISION', 'despacho', 5, false),
    ('excepciones_ejecutivo', 'Excepciones de mérito', 'ExcepcionesEjecutivo.pdf', 'TERMINO_EXCEPCIONES', 'escribiente', 7, true),
    ('auto_embargo', 'Auto de embargo / medida cautelar', 'AutoEmbargo.pdf', 'TRAMITE', 'despacho', 10, true),
    ('apelacion_escrito', 'Escrito de apelación', 'ApelacionSentencia.pdf', 'APELACION', 'secretaria', 22, false)
) as v (code, label_es, suggested_filename, stage_code, responsible_role, sort_band, is_repeatable)
where pd.code = 'civil_ejecutivo'
on conflict (process_definition_id, code) do nothing;

insert into public.case_act_types (
  process_definition_id, code, label_es, suggested_filename, stage_code, responsible_role, sort_band, is_repeatable
)
select pd.id, 'apelacion_escrito', 'Escrito de apelación', 'ApelacionSentencia.pdf', 'APELACION', 'secretaria', 22, false
from public.process_definitions pd
where pd.code in ('civil_ordinario', 'civil_jurisdiccion_voluntaria', 'civil_insolvencia', 'civil_otros')
on conflict (process_definition_id, code) do nothing;

insert into public.process_stage_act_requirements (
  process_definition_id, trigger_code, requirement_mode, required_act_codes, label_es
)
select pd.id, 'SECRETARIA_APELACION_RECIBIDA', 'all', array['apelacion_escrito'], 'Apelación de la sentencia recibida'
from public.process_definitions pd
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, trigger_code) do nothing;
