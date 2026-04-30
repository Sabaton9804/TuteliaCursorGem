-- Nombres alineados a juzgados civiles de circuito (Bogotá). Su despacho demo: 051.
-- Los id siguen siendo técnicos; el nombre visible es lo que ve la app en Configuración.

update public.courts
set
  name = 'Juzgado 051 Civil del Circuito de Bogotá',
  city = 'Bogotá D.C.',
  email = coalesce(nullif(trim(email), ''), 'j051ccbog@notificaciones.jud.co'),
  updated_at = now()
where id = 'court-1';

-- Ejemplos de otros despachos del mismo circuito (sin usuarios por defecto; útil para pruebas o multi-juzgado).
insert into public.courts (id, name, email, city)
values
  (
    'court-050',
    'Juzgado 050 Civil del Circuito de Bogotá',
    'j050ccbog@notificaciones.jud.co',
    'Bogotá D.C.'
  ),
  (
    'court-052',
    'Juzgado 052 Civil del Circuito de Bogotá',
    'j052ccbog@notificaciones.jud.co',
    'Bogotá D.C.'
  ),
  (
    'court-053',
    'Juzgado 053 Civil del Circuito de Bogotá',
    'j053ccbog@notificaciones.jud.co',
    'Bogotá D.C.'
  )
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  city = excluded.city,
  updated_at = now();
