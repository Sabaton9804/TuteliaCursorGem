-- Categoría de corporación emisora (Corte Constitucional, Suprema, Tribunal, Juzgado, etc.).

alter table public.precedents
  add column if not exists issuer_category text not null default 'otro'
    check (
      issuer_category in (
        'corte_constitucional',
        'corte_suprema',
        'consejo_estado',
        'tribunal',
        'juzgado',
        'juzgado_pequenas_causas',
        'comision',
        'otro'
      )
    );

create index if not exists precedents_court_issuer_category_idx
  on public.precedents (court_id, issuer_category, created_at desc);

create index if not exists precedents_court_specialty_issuer_idx
  on public.precedents (court_id, legal_specialty, issuer_category, created_at desc);

comment on column public.precedents.issuer_category is
  'Tipo de corporación que profirió el acto (corte, tribunal, juzgado). Complementa legal_specialty; en tutela la categoría distingue CC, TS, tribunales, juzgados.';
