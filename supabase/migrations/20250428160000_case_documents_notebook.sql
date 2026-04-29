-- Cuadernos del expediente digital (primera instancia, principal, incidentes).

alter table public.case_documents
  add column if not exists notebook_code text not null default 'PI_C01_PRINCIPAL';

comment on column public.case_documents.notebook_code is
  'Cuaderno lógico: PI_C01_PRINCIPAL (cuaderno principal C01), PI_INC_DESACATO (incidente desacato), etc.';

create index if not exists case_documents_case_notebook_order_idx
  on public.case_documents (case_id, notebook_code, sort_order);
