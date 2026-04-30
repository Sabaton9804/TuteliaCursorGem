-- Nota opcional cuando el despacho ajusta manualmente el fin del término de 10 días (excepciones).
alter table public.cases
  add column if not exists deadline_override_note text;

comment on column public.cases.deadline_override_note is
  'Motivo o referencia cuando deadline_at se corrige a mano (suspensión, rectificación, etc.).';
