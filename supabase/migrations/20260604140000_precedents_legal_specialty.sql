-- Especialidad del proceso en biblioteca de precedentes (filtros por tutela, civil, laboral, etc.).

alter table public.precedents
  add column if not exists legal_specialty text not null default 'otro'
    check (
      legal_specialty in (
        'tutela',
        'civil',
        'laboral',
        'familia',
        'penal',
        'administrativo',
        'agrario',
        'constitucional',
        'contencioso',
        'comercial',
        'mixto',
        'otro'
      )
    );

create index if not exists precedents_court_specialty_idx
  on public.precedents (court_id, legal_specialty, created_at desc);

comment on column public.precedents.legal_specialty is
  'Materia / especialidad del proceso (tutela, civil, laboral, familia, agrario, etc.) para filtrar la biblioteca.';
