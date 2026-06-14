# Evolución multi-tenant Tutelia

Documento vivo — **Fase A** completada en migraciones `20260613120000`–`20260613140000`.

## Principio

**Extender, no reemplazar.** El tenant operativo es `courts.id` (text: `court-1`, `court-050`, …). No se introduce `organizations` UUID ni un segundo schema de despachos.

## Mapa de identidad

| Concepto | Implementación |
|----------|----------------|
| Tenant | `courts.id` text |
| Usuario despacho | `profiles` + `profile_court_memberships` (M:N) |
| Platform admin | `platform_admins` (+ `profiles.is_superuser` durante transición) |
| Despacho activo | `current_court_id()` → membership default → `profiles.court_id` |
| Auditoría consola | `platform_audit_log` + RPC `log_platform_action()` |

## Helpers RLS (Fase A)

| Función | Rol |
|---------|-----|
| `is_platform_admin()` | Admin plataforma (`platform_admins` ∪ `is_superuser`) |
| `auth_is_superuser()` | **Alias** de `is_platform_admin()` (políticas legacy) |
| `auth_user_has_court(text)` | Acceso a filas de un despacho |
| `auth_user_has_case(uuid)` | Acceso vía expediente (tablas sin `court_id`) |
| `current_court_id()` | Despacho operativo del funcionario |
| `court_cui_official_code(text)` | CUI 12 dígitos (bulk import Fase 8) |

## Migración `is_superuser` → `platform_admins`

1. **Hecho (Fase A):** backfill automático `profiles.is_superuser = true` → `platform_admins`.
2. **Pendiente:** nuevos admins solo vía `platform_admins` (seed/CLI).
3. **Pendiente:** deprecar columna `profiles.is_superuser` cuando UI y seeds no la usen.

## Tablas operativas — estado RLS (Fase B pendiente)

Patrón **legacy** (join `profiles.court_id` — no respeta membresía M:N):

- `cases`, `case_documents`, `case_actions`, `case_word_reviews`
- `workflow_tasks`, `case_tasks`, `case_stages`, `precedents`, `precedent_chunks`
- `incident_desacato`, `template_variables`, `document_templates`
- `user_notifications`, `case_audit_log`, `case_document_ai_analyses`
- `case_sgde_folder_map`, `court_enabled_processes`, `courts`, `profiles`

Patrón **correcto** (`auth_user_has_court`):

- `court_mailboxes`, `outlook_message_reviews`

**Fase B:** macro `apply_court_rls_policies()` aplicada — ver `20260613150000`–`160000`.

## Catálogos (solo lectura tenant)

Reutilizar — no duplicar:

- `judicial_territories`, `judicial_specialties`, `judicial_entity_categories`
- `process_definitions`, CUI en `courts` (`dane_code`, `entity_code`, …)
- `court_radicacion_prefix()` (radicación con año)

## Consola platform (Fase D)

- Ruta `/plataforma` — solo `is_platform_admin()` (`PlatformConsoleGuard`)
- Listado paginado de despachos, KPIs, filtros (`PlatformCourtList`, `PlatformCourtFilters`)
- Crear despacho e invitar usuario vía API privilegiada (`server/platform-routes.ts`, `service_role`)
- Detalle por despacho: staff, auditoría (`PlatformCourtDetailView`)
- Enlace en sidebar solo para platform admin
- `courts.status`: `active` | `inactive` | `suspended`
- Búsqueda: índices `pg_trgm` en `name`, `id`, CUI compuesto
- **viewAs:** capa app (localStorage) — Fase C; no en JWT aún

## Bulk import CSV (Fase E)

- RPC `bulk_upsert_courts(p_rows jsonb)` — upsert por **CUI compuesto** (12 dígitos) o `id`
- Índice único `courts_cui_composite_unique_idx` en `(dane_code, entity_code, specialty_code, despacho_number)`
- CLI: `npm run bulk:import-courts -- scripts/samples/courts-import-template.csv`
- API: `POST /api/platform/courts/bulk-import` (consola, máx. 500 filas)
- Plantilla: `scripts/samples/courts-import-template.csv`
- Migración: `20260614120000_bulk_import_courts.sql`

## Admins regionales (Fase F)

**Tres niveles distintos — no mezclar:**

| Rol | Quién | Alcance operativo | Consola `/plataforma` |
|-----|--------|-------------------|------------------------|
| Funcionario despacho | Paola, juez, escribiente… | **Un solo** `court_id` (membresía) | No |
| Admin nacional (TI) | `platform_admins` / Sabaton98 | viewAs cualquier despacho | Todos los territorios |
| Admin regional (Rama) | `platform_regional_admins` | viewAs despachos **de su territorio** | Solo ese territorio |

- Tabla `platform_regional_admins` (`user_id`, `territory_id`) — **no** es para staff de juzgado.
- Seed demo: `npm run seed:regional-admin` → cuenta `Regional.Bogota` (no Paola).
- Admin nacional asigna/revoca en `/plataforma/regional`.
- Migración: `20260614150000_platform_regional_admins.sql`

## Auth anónimo

| Entorno | Decisión propuesta |
|---------|-------------------|
| Demo (`VITE_DEMO_MODE=true`) | Mantener `signInAnonymously` en `Shell.tsx` |
| Producción multi-tenant | Deshabilitar — Fase B |

## Verificación

```bash
# Tras supabase db push / migraciones aplicadas
npm run verify:multi-tenant
```

Criterio Fase A:

- `scripts/verify-multi-tenant-health.sql` pasa
- Usuario `court-1` no lee filas de `court-050` (RLS legacy — reforzar en Fase B)
- Platform admin ve ambos despachos

## Roadmap

| Fase | Estado | Entregable |
|------|--------|------------|
| A — Fundación DB | ✅ | Migraciones 20260613120000–140000 |
| B — RLS unificado | ✅ | Migraciones 20260613150000–160000 |
| C — Capa app | ✅ | TenantContext, tenantScope, PlatformAdminBar, viewAs |
| D — Consola `/plataforma` | ✅ | PlatformConsole, platform-routes, provisionar despacho/usuario |
| E — Bulk import CSV | ✅ | RPC `bulk_upsert_courts`, CLI `bulk:import-courts`, UI consola |
| F — Regional admins | ✅ | platform_regional_admins, consola por territorio |

## Referencias internas

- RLS core: `20260518120000_core_tables_rls_by_court.sql`
- Superuser: `20260526120000_profiles_superuser.sql`
- Membresía M:N: `20260605120000_court_mailboxes_shared.sql`
- Catálogo judicial: `20260529120000_judicial_process_platform_phase1.sql`
- Seguridad: `security_spec.md` (Dirty Dozen)
