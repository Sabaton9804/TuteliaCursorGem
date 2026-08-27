-- Corrige plazos y citas CGP en plantilla civil (semáforo falso en producción).
-- 369 (no 76): traslado verbal 20 hábiles.
-- 442 (no 443): excepciones ejecutivo 10 hábiles. El 431 (pago 5) no es esta etapa.
-- 322 (no 318): apelación fuera de audiencia 3 hábiles. El 318 es reposición.
-- No activa BD-only. No añade case_type. Overrides de despacho: solo si aún tienen el valor viejo del seed.

update public.process_stages_definition psd
set
  label = 'Término contestación (art. 369 CGP)',
  term_days = 20,
  term_type = 'habiles'
from public.process_definitions pd
where psd.process_definition_id = pd.id
  and pd.code in (
    'civil_ordinario',
    'civil_jurisdiccion_voluntaria',
    'civil_insolvencia',
    'civil_otros'
  )
  and psd.code = 'TERMINO_RESPUESTA';

update public.process_stages_definition psd
set
  label = 'Excepciones de mérito (art. 442 CGP)',
  term_days = 10,
  term_type = 'habiles'
from public.process_definitions pd
where psd.process_definition_id = pd.id
  and pd.code = 'civil_ejecutivo'
  and psd.code = 'TERMINO_EXCEPCIONES';

update public.process_stages_definition psd
set
  label = 'Apelación (art. 322 CGP)',
  term_days = 3,
  term_type = 'habiles'
from public.process_definitions pd
where psd.process_definition_id = pd.id
  and pd.process_domain = 'civil'
  and psd.code = 'TERMINO_APELACION';

update public.court_process_stages cps
set
  label = 'Término contestación (art. 369 CGP)',
  term_days = 20,
  term_type = 'habiles',
  updated_at = now()
from public.process_definitions pd
where cps.process_definition_id = pd.id
  and pd.code in (
    'civil_ordinario',
    'civil_jurisdiccion_voluntaria',
    'civil_insolvencia',
    'civil_otros'
  )
  and cps.stage_code = 'TERMINO_RESPUESTA'
  and cps.is_custom = false
  and (
    cps.term_days is not distinct from 20
    or cps.label ilike '%art. 76%'
  );

update public.court_process_stages cps
set
  label = 'Excepciones de mérito (art. 442 CGP)',
  term_days = 10,
  term_type = 'habiles',
  updated_at = now()
from public.process_definitions pd
where cps.process_definition_id = pd.id
  and pd.code = 'civil_ejecutivo'
  and cps.stage_code = 'TERMINO_EXCEPCIONES'
  and cps.is_custom = false
  and (
    cps.term_days is not distinct from 5
    or cps.label ilike '%art. 443%'
  );

update public.court_process_stages cps
set
  label = 'Apelación (art. 322 CGP)',
  term_days = 3,
  term_type = 'habiles',
  updated_at = now()
from public.process_definitions pd
where cps.process_definition_id = pd.id
  and pd.process_domain = 'civil'
  and cps.stage_code = 'TERMINO_APELACION'
  and cps.is_custom = false
  and (
    cps.term_days is not distinct from 10
    or cps.label ilike '%art. 318%'
  );
