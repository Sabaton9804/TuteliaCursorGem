-- Reglas de reparto de sustanciador por juzgado y persistencia en cases.assigned_to

alter table public.courts
  add column if not exists sustanciador_assignment_mode text not null default 'hash_stable'
    check (
      sustanciador_assignment_mode in (
        'hash_stable',
        'radicado_parity',
        'alternating',
        'manual_unassigned'
      )
    );

alter table public.courts
  add column if not exists sustanciador_rr_cursor smallint not null default 0
    check (sustanciador_rr_cursor in (0, 1));

comment on column public.courts.sustanciador_assignment_mode is
  'Al radicar: hash_stable (derivado del id del caso), radicado_parity (último dígito del radicado), alternating (una y una), manual_unassigned (no asigna al radicar).';

comment on column public.courts.sustanciador_rr_cursor is
  'Índice 0|1 del siguiente sustanciador en modo alternating (una y una).';

-- Expedientes que aún no tenían assigned_to: persistir por paridad del radicado (par → primer sustanciador del seed, impar → segundo).
update public.cases c
set assigned_to = case
  when mod(
    coalesce(
      nullif(right(regexp_replace(c.radicado, '\D', '', 'g'), 1), ''),
      '0'
    )::int,
    2
  ) = 0
    then 'Diego Enrique Guarin Vega'
  else 'Myriam Francesa Fonseca Alvarez'
end
where c.assigned_to is null or btrim(c.assigned_to) = '';
