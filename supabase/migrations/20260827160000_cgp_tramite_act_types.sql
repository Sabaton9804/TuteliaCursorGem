/**
 * Overlay de actos CGP (verbal 370/372/373, pertenencia 375, ejecutivo 443).
 * No crea case_type. No activa BD-only.
 */
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
    ('descorre_370', 'Descorre excepciones de mérito (art. 370)', 'DescorreExcepcionesMerito.pdf', 'TRAMITE', 'escribiente', 13, true),
    ('auto_resuelve_previas', 'Auto que resuelve excepciones previas (100-101)', 'AutoResuelvePrevias.pdf', 'TRAMITE', 'despacho', 14, false),
    ('acta_372', 'Acta audiencia inicial (art. 372)', 'ActaAudienciaInicial.pdf', 'TRAMITE', 'secretaria', 15, false),
    ('acta_373', 'Acta instrucción y juzgamiento (art. 373)', 'ActaInstruccionJuzgamiento.pdf', 'TRAMITE', 'secretaria', 16, false),
    ('inscripcion_orip', 'Inscripción en ORIP (375 nums. 5-6)', 'InscripcionOrip.pdf', 'ADMISION', 'secretaria', 9, false),
    ('emplazamiento', 'Emplazamiento de indeterminados (375 nums. 5-6)', 'Emplazamiento.pdf', 'ADMISION', 'secretaria', 9, false),
    ('valla', 'Constancia de valla y fotos (375 num. 7)', 'ConstanciaValla.pdf', 'TRAMITE', 'secretaria', 17, false),
    ('curador_indeterminados', 'Curador de indeterminados (375 num. 8)', 'AutoCuradorIndeterminados.pdf', 'TRAMITE', 'despacho', 18, false),
    ('acta_inspeccion_judicial', 'Acta inspección judicial personal (375 num. 9)', 'ActaInspeccionJudicial.pdf', 'TRAMITE', 'despacho', 19, false)
) as v (code, label_es, suggested_filename, stage_code, responsible_role, sort_band, is_repeatable)
where pd.code in (
  'civil_ordinario',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict (process_definition_id, code) do nothing;

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
  'traslado_excepciones_ejecutante',
  'Traslado de excepciones al ejecutante (art. 443)',
  'TrasladoExcepcionesEjecutante.pdf',
  'TRAMITE',
  'secretaria',
  13,
  false
from public.process_definitions pd
where pd.code = 'civil_ejecutivo'
on conflict (process_definition_id, code) do nothing;
