-- Civil vigente = Civil-Oral. El enlace previo solo cargaba Civil-Escrito (legado),
-- por eso el selector SIERJU en radicación quedaba en «Sin clasificar» aunque la IA
-- ya hubiera tipificado p. ej. declarativos_especiales_divisorio.

insert into public.process_definition_sierju_classes (process_definition_id, sierju_process_class_id, is_default)
select
  pd.id,
  spc.id,
  (spc.code = 'otros_procesos' and pd.code = 'civil_otros')
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
and ss.code = 'civil_1a_oral'
on conflict (process_definition_id, sierju_process_class_id) do nothing;
