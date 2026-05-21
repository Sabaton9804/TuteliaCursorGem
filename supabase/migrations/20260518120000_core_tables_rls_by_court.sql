-- Endurece RLS multi-tenant en tablas núcleo (antes: authenticated con using true).
-- Patrón: perfil del usuario (auth.uid()) debe pertenecer al mismo court_id que el expediente o la fila.

-- ---------------------------------------------------------------------------
-- courts
-- ---------------------------------------------------------------------------
drop policy if exists courts_authenticated_all on public.courts;

create policy courts_select_same_court on public.courts for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = courts.id)
);

create policy courts_update_same_court on public.courts for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = courts.id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = courts.id)
);

-- Inserción de juzgados: solo service_role / SQL admin (sin policy INSERT para authenticated).

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
drop policy if exists cases_authenticated_all on public.cases;

create policy cases_select_same_court on public.cases for select to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = cases.court_id)
);

create policy cases_insert_same_court on public.cases for insert to authenticated with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = cases.court_id)
);

create policy cases_update_same_court on public.cases for update to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = cases.court_id)
) with check (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = cases.court_id)
);

create policy cases_delete_same_court on public.cases for delete to authenticated using (
  exists (select 1 from public.profiles v where v.id = auth.uid() and v.court_id = cases.court_id)
);

-- ---------------------------------------------------------------------------
-- case_documents (sin court_id: vía cases)
-- ---------------------------------------------------------------------------
drop policy if exists case_documents_authenticated_all on public.case_documents;

create policy case_documents_select_same_court on public.case_documents for select to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_documents.case_id
  )
);

create policy case_documents_insert_same_court on public.case_documents for insert to authenticated with check (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_documents.case_id
  )
);

create policy case_documents_update_same_court on public.case_documents for update to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_documents.case_id
  )
) with check (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_documents.case_id
  )
);

create policy case_documents_delete_same_court on public.case_documents for delete to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_documents.case_id
  )
);

-- ---------------------------------------------------------------------------
-- case_actions
-- ---------------------------------------------------------------------------
drop policy if exists case_actions_authenticated_all on public.case_actions;

create policy case_actions_select_same_court on public.case_actions for select to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_actions.case_id
  )
);

create policy case_actions_insert_same_court on public.case_actions for insert to authenticated with check (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_actions.case_id
  )
);

create policy case_actions_update_same_court on public.case_actions for update to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_actions.case_id
  )
) with check (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_actions.case_id
  )
);

create policy case_actions_delete_same_court on public.case_actions for delete to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_actions.case_id
  )
);

-- ---------------------------------------------------------------------------
-- case_word_reviews
-- ---------------------------------------------------------------------------
drop policy if exists case_word_reviews_authenticated_all on public.case_word_reviews;

create policy case_word_reviews_select_same_court on public.case_word_reviews for select to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_word_reviews.case_id
  )
);

create policy case_word_reviews_insert_same_court on public.case_word_reviews for insert to authenticated with check (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_word_reviews.case_id
  )
);

create policy case_word_reviews_update_same_court on public.case_word_reviews for update to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_word_reviews.case_id
  )
) with check (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_word_reviews.case_id
  )
);

create policy case_word_reviews_delete_same_court on public.case_word_reviews for delete to authenticated using (
  exists (
    select 1
    from public.cases c
    inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
    where c.id = case_word_reviews.case_id
  )
);

-- ---------------------------------------------------------------------------
-- Storage case-documents: ruta cases/{case_id}/...
-- ---------------------------------------------------------------------------
drop policy if exists "case_documents_storage_select" on storage.objects;
drop policy if exists "case_documents_storage_insert" on storage.objects;
drop policy if exists "case_documents_storage_update" on storage.objects;
drop policy if exists "case_documents_storage_delete" on storage.objects;

create policy "case_documents_storage_select"
  on storage.objects for select to authenticated using (
    bucket_id = 'case-documents'
    and exists (
      select 1
      from public.cases c
      inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
      where c.id::text = split_part(name, '/', 2)
    )
  );

create policy "case_documents_storage_insert"
  on storage.objects for insert to authenticated with check (
    bucket_id = 'case-documents'
    and exists (
      select 1
      from public.cases c
      inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
      where c.id::text = split_part(name, '/', 2)
    )
  );

create policy "case_documents_storage_update"
  on storage.objects for update to authenticated using (
    bucket_id = 'case-documents'
    and exists (
      select 1
      from public.cases c
      inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
      where c.id::text = split_part(name, '/', 2)
    )
  )
  with check (
    bucket_id = 'case-documents'
    and exists (
      select 1
      from public.cases c
      inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
      where c.id::text = split_part(name, '/', 2)
    )
  );

create policy "case_documents_storage_delete"
  on storage.objects for delete to authenticated using (
    bucket_id = 'case-documents'
    and exists (
      select 1
      from public.cases c
      inner join public.profiles v on v.id = auth.uid() and v.court_id = c.court_id
      where c.id::text = split_part(name, '/', 2)
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime (idempotente): tablas usadas por la app
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array[
    'cases',
    'case_stages',
    'case_word_reviews',
    'workflow_tasks',
    'user_notifications',
    'incident_desacato'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
