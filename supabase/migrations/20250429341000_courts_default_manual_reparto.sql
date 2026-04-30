-- Nuevos juzgados: por defecto reparto manual (usted asigna en el expediente). No modifica filas existentes.
alter table public.courts
  alter column sustanciador_assignment_mode set default 'manual_unassigned';
