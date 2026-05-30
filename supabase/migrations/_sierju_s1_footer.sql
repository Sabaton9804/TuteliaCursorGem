-- ---------------------------------------------------------------------------
-- Despacho piloto J051 + puente process_definitions <-> clases constitucionales
-- ---------------------------------------------------------------------------

update public.courts
set sierju_form_template_code = 'sierju_civil_circuito_2023_v4'
where id = 'court-1'
  and (sierju_form_template_code is null or sierju_form_template_code <> 'sierju_civil_circuito_2023_v4');

insert into public.process_definition_sierju_classes (process_definition_id, sierju_process_class_id, is_default)
select pd.id, spc.id, spc.code = 'otros'
from public.process_definitions pd
cross join public.sierju_process_classes spc
inner join public.sierju_sections ss on ss.id = spc.section_id
where pd.code in ('tutela_primera', 'tutela_segunda')
  and ss.form_template_code = 'sierju_civil_circuito_2023_v4'
  and ss.code = 'movimiento_tutelas'
on conflict do nothing;

insert into public.process_definition_sierju_classes (process_definition_id, sierju_process_class_id, is_default)
select pd.id, spc.id, spc.code = 'otros'
from public.process_definitions pd
cross join public.sierju_process_classes spc
inner join public.sierju_sections ss on ss.id = spc.section_id
where pd.code = 'consulta_desacato'
  and ss.form_template_code = 'sierju_civil_circuito_2023_v4'
  and ss.code = 'consultas_desacato'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS: catalogo SIERJU = lectura authenticated; escritura solo service_role
-- ---------------------------------------------------------------------------

alter table public.sierju_form_templates enable row level security;
alter table public.sierju_sections enable row level security;
alter table public.sierju_process_classes enable row level security;
alter table public.sierju_movement_types enable row level security;
alter table public.process_definition_sierju_classes enable row level security;
alter table public.sierju_tyba_class_map enable row level security;

drop policy if exists sierju_form_templates_select on public.sierju_form_templates;
create policy sierju_form_templates_select on public.sierju_form_templates
  for select to authenticated using (true);

drop policy if exists sierju_sections_select on public.sierju_sections;
create policy sierju_sections_select on public.sierju_sections
  for select to authenticated using (true);

drop policy if exists sierju_process_classes_select on public.sierju_process_classes;
create policy sierju_process_classes_select on public.sierju_process_classes
  for select to authenticated using (true);

drop policy if exists sierju_movement_types_select on public.sierju_movement_types;
create policy sierju_movement_types_select on public.sierju_movement_types
  for select to authenticated using (true);

drop policy if exists process_definition_sierju_classes_select on public.process_definition_sierju_classes;
create policy process_definition_sierju_classes_select on public.process_definition_sierju_classes
  for select to authenticated using (true);

drop policy if exists sierju_tyba_class_map_select on public.sierju_tyba_class_map;
create policy sierju_tyba_class_map_select on public.sierju_tyba_class_map
  for select to authenticated using (true);
