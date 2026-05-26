-- Superusuario: acceso RLS a todos los despachos (casos, documentos, storage, etc.).

alter table public.profiles
  add column if not exists is_superuser boolean not null default false;

comment on column public.profiles.is_superuser is
  'Si true, el usuario omite restricciones RLS por court_id (soporte / administración de plataforma).';

create or replace function public.auth_is_superuser ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_superuser from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

comment on function public.auth_is_superuser () is
  'Usado en políticas RLS para bypass multi-despacho.';

-- courts
create policy courts_select_superuser on public.courts for select to authenticated using (
  public.auth_is_superuser ()
);

create policy courts_update_superuser on public.courts for update to authenticated using (
  public.auth_is_superuser ()
) with check (public.auth_is_superuser ());

-- cases
create policy cases_select_superuser on public.cases for select to authenticated using (
  public.auth_is_superuser ()
);

create policy cases_insert_superuser on public.cases for insert to authenticated with check (
  public.auth_is_superuser ()
);

create policy cases_update_superuser on public.cases for update to authenticated using (
  public.auth_is_superuser ()
) with check (public.auth_is_superuser ());

create policy cases_delete_superuser on public.cases for delete to authenticated using (
  public.auth_is_superuser ()
);

-- case_documents
create policy case_documents_select_superuser on public.case_documents for select to authenticated using (
  public.auth_is_superuser ()
);

create policy case_documents_insert_superuser on public.case_documents for insert to authenticated with check (
  public.auth_is_superuser ()
);

create policy case_documents_update_superuser on public.case_documents for update to authenticated using (
  public.auth_is_superuser ()
) with check (public.auth_is_superuser ());

create policy case_documents_delete_superuser on public.case_documents for delete to authenticated using (
  public.auth_is_superuser ()
);

-- case_actions
create policy case_actions_select_superuser on public.case_actions for select to authenticated using (
  public.auth_is_superuser ()
);

create policy case_actions_insert_superuser on public.case_actions for insert to authenticated with check (
  public.auth_is_superuser ()
);

create policy case_actions_update_superuser on public.case_actions for update to authenticated using (
  public.auth_is_superuser ()
) with check (public.auth_is_superuser ());

create policy case_actions_delete_superuser on public.case_actions for delete to authenticated using (
  public.auth_is_superuser ()
);

-- case_word_reviews
create policy case_word_reviews_select_superuser on public.case_word_reviews for select to authenticated using (
  public.auth_is_superuser ()
);

create policy case_word_reviews_insert_superuser on public.case_word_reviews for insert to authenticated with check (
  public.auth_is_superuser ()
);

create policy case_word_reviews_update_superuser on public.case_word_reviews for update to authenticated using (
  public.auth_is_superuser ()
) with check (public.auth_is_superuser ());

create policy case_word_reviews_delete_superuser on public.case_word_reviews for delete to authenticated using (
  public.auth_is_superuser ()
);

-- profiles (ver todos los perfiles)
create policy profiles_select_superuser on public.profiles for select to authenticated using (
  public.auth_is_superuser ()
);

-- storage case-documents
create policy "case_documents_storage_select_superuser"
  on storage.objects for select to authenticated using (
    bucket_id = 'case-documents' and public.auth_is_superuser ()
  );

create policy "case_documents_storage_insert_superuser"
  on storage.objects for insert to authenticated with check (
    bucket_id = 'case-documents' and public.auth_is_superuser ()
  );

create policy "case_documents_storage_update_superuser"
  on storage.objects for update to authenticated using (
    bucket_id = 'case-documents' and public.auth_is_superuser ()
  )
  with check (bucket_id = 'case-documents' and public.auth_is_superuser ());

create policy "case_documents_storage_delete_superuser"
  on storage.objects for delete to authenticated using (
    bucket_id = 'case-documents' and public.auth_is_superuser ()
  );
