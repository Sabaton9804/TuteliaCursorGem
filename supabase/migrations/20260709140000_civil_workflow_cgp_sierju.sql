-- Workflow civil CGP ampliado + enlace SIERJU civil a process_definitions.

create or replace function public._seed_civil_process_stages_cgp (p_process_code text)
returns void
language plpgsql
as $$
declare
  v_pid uuid;
begin
  select id into v_pid from public.process_definitions where code = p_process_code;
  if v_pid is null then
    raise exception 'process_definitions % no existe', p_process_code;
  end if;

  delete from public.process_stages_definition where process_definition_id = v_pid;

  insert into public.process_stages_definition (
    process_definition_id, code, label, order_index, stage_kind,
    term_days, term_type, responsible_role, generates_alert, alert_threshold_pct,
    workflow_task_type
  )
  values
    (v_pid, 'RADICACION', 'Radicación', 1, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'ADMISION', 'Admisión / inadmisión', 2, 'branch', null, 'none', 'despacho', true, 75, 'generate_notifs'),
    (v_pid, 'NOTIFICACION_AUTO_ADMISORIO', 'Notificación auto admisorio', 3, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'TERMINO_RESPUESTA', 'Término contestación (art. 76 CGP)', 4, 'linear', 20, 'habiles', 'secretaria', true, 75, null),
    (v_pid, 'TRAMITE', 'Trámite (prueba, audiencia)', 5, 'linear', null, 'none', 'despacho', false, 75, null),
    (v_pid, 'INGRESO_DESPACHO_FALLO', 'Ingreso despacho / sentencia', 6, 'linear', null, 'none', 'despacho', true, 75, null),
    (v_pid, 'FALLO', 'Sentencia / auto definitivo', 7, 'linear', null, 'none', 'despacho', true, 75, 'generate_notifs'),
    (v_pid, 'NOTIFICACION_FALLO', 'Notificación sentencia', 8, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'EJECUTORIA', 'Ejecutoria / archivo', 9, 'terminal', null, 'none', 'secretaria', false, 75, null);
end;
$$;

select public._seed_civil_process_stages_cgp('civil_ordinario');
select public._seed_civil_process_stages_cgp('civil_ejecutivo');
select public._seed_civil_process_stages_cgp('civil_jurisdiccion_voluntaria');
select public._seed_civil_process_stages_cgp('civil_insolvencia');
select public._seed_civil_process_stages_cgp('civil_otros');

drop function if exists public._seed_civil_process_stages_cgp (text);

-- Enlace SIERJU civil: clases de civil_1a_escrito a process_definitions civiles
insert into public.process_definition_sierju_classes (process_definition_id, sierju_process_class_id, is_default)
select pd.id, spc.id, (spc.code = 'declarativos_ordinarios' and pd.code = 'civil_ordinario')
from public.process_definitions pd
cross join public.sierju_process_classes spc
join public.sierju_sections ss on ss.id = spc.section_id
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
and ss.form_template_code = 'sierju_civil_circuito_2023_v4'
and ss.code = 'civil_1a_escrito'
and (
  (pd.code = 'civil_ordinario' and spc.code like 'declarativos%')
  or (pd.code = 'civil_ejecutivo' and spc.code like 'ejecutiv%')
  or (pd.code = 'civil_insolvencia' and spc.code like 'insolvencia%')
  or (pd.code in ('civil_jurisdiccion_voluntaria', 'civil_otros'))
)
on conflict (process_definition_id, sierju_process_class_id) do nothing;
