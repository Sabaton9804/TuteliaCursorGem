-- Plazo global tutela segunda instancia: 20 días hábiles (Decreto 2591/1991, art. 32).

update public.process_definitions
set
  case_term_days = 20,
  case_term_type = 'habiles',
  description = 'Plazo global 20 días hábiles desde recepción del expediente (art. 32 D.2591/91) → cases.deadline_at.'
where code = 'tutela_segunda';

comment on column public.process_definitions.case_term_days is
  'Plazo global del caso: tutela 1ª art. 29 (10 háb.); tutela 2ª art. 32 (20 háb. desde recepción).';
