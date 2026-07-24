-- Juzgado 017 Civil del Circuito de Bogotá D.C. (tenant court-017).
-- CUI despacho: 110013103017 (DANE 11001 + entidad 31 + civil circuito 03 + despacho 017).

insert into public.courts (
  id,
  name,
  official_name,
  email,
  city,
  status,
  dane_code,
  entity_code,
  specialty_code,
  despacho_number,
  territory_id,
  entity_category_id,
  judicial_specialty_id
)
values (
  'court-017',
  'Juzgado 017 Civil del Circuito de Bogotá',
  'Juzgado 017 Civil del Circuito de Bogotá D.C.',
  'ccto17bt@cendoj.ramajudicial.gov.co',
  'Bogotá D.C.',
  'active',
  '11001',
  '31',
  '03',
  '017',
  (select id from public.judicial_territories where dane_code = '11001'),
  (select id from public.judicial_entity_categories where code = 'circuito'),
  (select id from public.judicial_specialties where code = 'civil')
)
on conflict (id) do update set
  name = excluded.name,
  official_name = excluded.official_name,
  email = excluded.email,
  city = excluded.city,
  status = excluded.status,
  dane_code = excluded.dane_code,
  entity_code = excluded.entity_code,
  specialty_code = excluded.specialty_code,
  despacho_number = excluded.despacho_number,
  territory_id = excluded.territory_id,
  entity_category_id = excluded.entity_category_id,
  judicial_specialty_id = excluded.judicial_specialty_id,
  updated_at = now();

-- Tutela + civiles (mismo paquete operativo que court-1 / J51 piloto).
insert into public.court_enabled_processes (court_id, process_definition_id)
select 'court-017', pd.id
from public.process_definitions pd
where pd.code in (
  'tutela_primera',
  'tutela_segunda',
  'consulta_desacato',
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros'
)
on conflict do nothing;
