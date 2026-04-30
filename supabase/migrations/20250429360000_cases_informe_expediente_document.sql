-- Vincula la pieza PDF del informe de ingreso incorporada al expediente al marcar «Informe listo» (referencia estable).

alter table public.cases
  add column if not exists informe_ingreso_document_id uuid references public.case_documents (id) on delete set null;

comment on column public.cases.informe_ingreso_document_id is
  'Fila en case_documents del PDF del informe de ingreso al expediente; la pieza persiste (integridad); on delete set null si se borra la fila por otro medio.';
