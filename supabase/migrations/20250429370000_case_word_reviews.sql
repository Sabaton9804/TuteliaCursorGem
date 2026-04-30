-- Flujo sustanciador → juez: Word en expediente, apuntes del juez, corrección, PDF firmado.

create table if not exists public.case_word_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  word_document_id uuid not null references public.case_documents (id) on delete cascade,
  status text not null default 'pendiente_juez'
    check (status in (
      'pendiente_juez',
      'observaciones_juez',
      'aprobado_firma_pendiente',
      'cerrado_con_pdf_firmado'
    )),
  judge_notes text,
  sustanciador_reply text,
  signed_pdf_document_id uuid references public.case_documents (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists case_word_reviews_case_updated_idx
  on public.case_word_reviews (case_id, updated_at desc);

comment on table public.case_word_reviews is
  'Revisión de borradores Word en despacho: apuntes, nueva versión, aprobación y cierre con PDF firmado (RLS: authenticated; la disciplina de uso es organizativa).';

comment on column public.case_word_reviews.status is
  'pendiente_juez: espera revisión; observaciones_juez: devuelto para corrección; aprobado_firma_pendiente: aprobado, falta PDF firmado en expediente; cerrado_con_pdf_firmado: PDF vinculado.';

alter table public.case_word_reviews enable row level security;

drop policy if exists case_word_reviews_authenticated_all on public.case_word_reviews;

create policy case_word_reviews_authenticated_all
  on public.case_word_reviews for all
  to authenticated
  using (true)
  with check (true);

-- Realtime (opcional): en Supabase → Database → Publications → supabase_realtime, añada la tabla si desea actualización en vivo en la pestaña «Documentos por revisar».
