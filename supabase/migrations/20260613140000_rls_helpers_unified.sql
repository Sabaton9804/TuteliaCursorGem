-- Fase A evolutiva (3/3): helpers RLS unificados (court_id text, membresía M:N).
-- depends on: 20260605120000_court_mailboxes_shared.sql (auth_user_has_court)
-- depends on: 20260613120000_platform_admins.sql (is_platform_admin)

-- ---------------------------------------------------------------------------
-- current_court_id — despacho activo del funcionario
-- Precedencia: membresía default → profiles.court_id (legacy)
-- viewAs (platform admin) se resuelve en capa app (Fase B); no en JWT aún.
-- ---------------------------------------------------------------------------

create or replace function public.current_court_id ()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.court_id
      from public.profile_court_memberships m
      where m.profile_id = auth.uid ()
        and m.is_default = true
      limit 1
    ),
    (
      select nullif(trim(p.court_id), '')
      from public.profiles p
      where p.id = auth.uid ()
      limit 1
    )
  );
$$;

comment on function public.current_court_id () is
  'Despacho operativo del usuario: profile_court_memberships.is_default o profiles.court_id.';

-- ---------------------------------------------------------------------------
-- auth_user_has_court — acceso a filas de un despacho
-- Platform admin: bypass total (RLS). Staff: membresía M:N o perfil legacy.
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_has_court (p_court_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_court_id is not null
    and length(trim(p_court_id)) > 0
    and (
      public.is_platform_admin ()
      or exists (
        select 1
        from public.profile_court_memberships m
        where m.profile_id = auth.uid ()
          and m.court_id = p_court_id
      )
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid ()
          and p.court_id = p_court_id
      )
    );
$$;

comment on function public.auth_user_has_court (text) is
  'True si platform admin o el usuario pertenece al despacho (membresía o court_id legacy).';

-- ---------------------------------------------------------------------------
-- auth_user_has_case — tablas sin court_id directo (case_documents, etc.)
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_has_case (p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = p_case_id
      and public.auth_user_has_court (c.court_id)
  );
$$;

comment on function public.auth_user_has_case (uuid) is
  'True si el usuario puede acceder al expediente (vía court_id del case).';

-- ---------------------------------------------------------------------------
-- Inventario Fase B — tablas con court_id aún en patrón profiles join legacy
-- (grep 20260613 — NO migrar en este turno; apply_court_rls_policies en Fase 2)
-- ---------------------------------------------------------------------------
-- cases, case_documents, case_actions, case_word_reviews, courts
-- workflow_tasks, case_tasks, case_stages, precedents, precedent_chunks
-- incident_desacato, template_variables, document_templates
-- user_notifications, case_audit_log, case_document_ai_analyses
-- case_sgde_folder_map, court_enabled_processes
-- outlook_message_reviews (OK: auth_user_has_court)
-- court_mailboxes (OK: auth_user_has_court)
-- profile_court_memberships (solo select own — ampliar en Fase 2)
