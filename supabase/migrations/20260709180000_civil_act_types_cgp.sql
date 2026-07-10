-- Actos procesales y gates para procesos civiles CGP (ordinario, ejecutivo, etc.).

insert into public.case_act_types (
  process_definition_id,
  code,
  label_es,
  suggested_filename,
  stage_code,
  responsible_role,
  sort_band,
  is_repeatable
)
select
  pd.id,
  v.code,
  v.label_es,
  v.suggested_filename,
  v.stage_code,
  v.responsible_role,
  v.sort_band,
  v.is_repeatable
from public.process_definitions pd
cross join (
  values
    ('escrito_demanda', 'Demanda / escrito inicial', 'EscritoDemanda.pdf', 'RADICACION', 'secretaria', 1, false),
    ('informe_ingreso', 'Informe de ingreso al despacho', 'InformeIngresoDespacho.pdf', 'RADICACION', 'secretaria', 2, false),
    ('auto_admite', 'Auto admisorio (PDF firmado)', 'AutoAdmiteDemanda.pdf', 'ADMISION', 'despacho', 3, false),
    ('notificacion_admisorio', 'Notificación auto admisorio', 'NotificacionAutoAdmite.pdf', 'NOTIFICACION_AUTO_ADMISORIO', 'escribiente', 4, false),
    ('contestacion_demanda', 'Contestación de la demanda', 'ContestacionDemanda.pdf', 'TERMINO_RESPUESTA', 'escribiente', 5, true),
    ('auto_interlocutorio', 'Auto interlocutorio (trámite)', 'AutoInterlocutorio.pdf', 'TRAMITE', 'despacho', 10, true),
    ('prueba_documental', 'Prueba documental / decreto de pruebas', 'DecretoPruebas.pdf', 'TRAMITE', 'despacho', 11, true),
    ('acta_audiencia', 'Acta de audiencia', 'ActaAudiencia.pdf', 'TRAMITE', 'secretaria', 12, true),
    ('sentencia', 'Sentencia (PDF firmado)', 'Sentencia.pdf', 'FALLO', 'despacho', 20, false),
    ('notificacion_fallo', 'Notificación de la sentencia', 'NotificacionSentencia.pdf', 'NOTIFICACION_FALLO', 'escribiente', 21, false),
    ('auto_inadmite', 'Auto inadmisorio (PDF firmado)', 'AutoInadmiteDemanda.pdf', 'INADMISION', 'despacho', 22, false),
    ('auto_rechazo', 'Auto de rechazo (PDF firmado)', 'AutoRechazoDemanda.pdf', 'RECHAZO', 'despacho', 23, false)
) as v (code, label_es, suggested_filename, stage_code, responsible_role, sort_band, is_repeatable)
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, code) do nothing;

insert into public.process_stage_act_requirements (
  process_definition_id,
  trigger_code,
  requirement_mode,
  required_act_codes,
  label_es
)
select pd.id, v.trigger_code, v.requirement_mode, v.required_act_codes, v.label_es
from public.process_definitions pd
cross join (
  values
    (
      'SECRETARIA_NOTIFICACION_AUTO_ENVIADA',
      'all',
      array['auto_admite', 'notificacion_admisorio'],
      'Notificación del auto admisorio enviada'
    ),
    (
      'SECRETARIA_NOTIFICACION_FALLO_ENVIADA',
      'all',
      array['sentencia', 'notificacion_fallo'],
      'Notificación de la sentencia enviada'
    ),
    (
      'DESPACHO_INADMISION_REGISTRADA',
      'all',
      array['auto_inadmite'],
      'Inadmisión registrada'
    ),
    (
      'DESPACHO_RECHAZO_REGISTRADO',
      'all',
      array['auto_rechazo'],
      'Rechazo de demanda registrado'
    )
) as v (trigger_code, requirement_mode, required_act_codes, label_es)
where pd.code in (
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, trigger_code) do nothing;
