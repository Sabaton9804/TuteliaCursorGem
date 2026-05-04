-- Capa de revisión enriquecida (TipTap JSON + marcas) guardada en Tutelia, además del .docx en expediente.

alter table public.case_word_reviews
  add column if not exists review_markup_json jsonb;

comment on column public.case_word_reviews.review_markup_json is
  'Borrador de revisión en app (p. ej. documento TipTap + comentarios). No sustituye el Word del expediente; complementa la revisión integral desde Tutelia.';
