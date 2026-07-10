-- Alinear pipeline tutela 1ª en BD con STAGE_PIPELINE_BY_CASE_TYPE (TS):
-- … → TERMINO_IMPUGNACION → IMPUGNACION → REMISION_SUPERIOR → EJECUTORIA
-- (antes saltaba a EJECUTORIA y REMISION_CORTE, propias de tutela 2ª).

do $$
declare
  v_pid uuid;
begin
  select id into v_pid from public.process_definitions where code = 'tutela_primera';
  if v_pid is null then
    raise notice 'tutela_primera: process_definitions no encontrado; omitiendo.';
    return;
  end if;

  delete from public.process_stages_definition where process_definition_id = v_pid;

  insert into public.process_stages_definition (
    process_definition_id,
    code,
    label,
    order_index,
    stage_kind,
    term_days,
    term_type,
    responsible_role,
    generates_alert,
    alert_threshold_pct,
    workflow_task_type
  )
  values
    (v_pid, 'RADICACION', 'Radicación', 1, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'ADMISION', 'Admisión', 2, 'linear', null, 'none', 'despacho', false, 75, 'generate_notifs'),
    (v_pid, 'NOTIFICACION_AUTO_ADMISORIO', 'Notificación auto admisorio', 3, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'TERMINO_RESPUESTA', 'Término de respuesta', 4, 'linear', 2, 'habiles', 'secretaria', true, 75, null),
    (v_pid, 'INGRESO_DESPACHO_FALLO', 'Ingreso despacho / fallo', 5, 'linear', null, 'none', 'despacho', false, 75, null),
    (v_pid, 'FALLO', 'Fallo', 6, 'linear', null, 'none', 'despacho', false, 75, 'generate_notifs'),
    (v_pid, 'NOTIFICACION_FALLO', 'Notificación del fallo', 7, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'TERMINO_IMPUGNACION', 'Término de impugnación', 8, 'linear', 3, 'habiles', 'secretaria', true, 75, null),
    (v_pid, 'IMPUGNACION', 'Impugnación', 9, 'linear', null, 'none', 'secretaria', false, 75, null),
    (v_pid, 'REMISION_SUPERIOR', 'Remisión al superior', 10, 'linear', 2, 'habiles', 'secretaria', true, 75, null),
    (v_pid, 'EJECUTORIA', 'Ejecutoria', 11, 'linear', null, 'none', 'despacho', false, 75, null);
end;
$$;
