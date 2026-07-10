# Auditoría técnica — Tutelia (código base)

**Alcance:** informe derivado del análisis del repositorio en disco (TypeScript/SQL/configuración). Donde algo no aparece en el código revisado, se indica explícitamente como *no verificado en este informe*.

**Última actualización:** julio 2026 (F0 — alineación con estado real del repo).  
**Plan de cierre de gaps:** `docs/plan-maestro-cierre-gaps-operacion-judicial.md`

### Cambios respecto a versiones anteriores de este informe

| Tema | Antes (informe desactualizado) | Ahora (código jul 2026) |
|------|-------------------------------|---------------------------|
| Migraciones SQL | ~22 archivos | **64** en `supabase/migrations/` |
| SGDE | «No implementado» | **Operativo:** `/sgde`, `/import-sgde`, `server/sgde-*.ts`, credenciales en `Settings.tsx` |
| Procesos civiles | Solo tutelas | **5 tipos civiles** radicables + `/procesos/civiles` |
| Contexto despacho | Solo `SessionCourtContext` | **`CourtOperationalContext`** + `process_definitions` |
| Etapas workflow | No documentadas | `case_stages`, `case-workflow-stages.ts`, carril UI |
| Build | No verificado | `npm run build` **exitoso** (jul 2026) |

---

## 1. Arquitectura general

### 1.1 Stack tecnológico (según `package.json`)

| Capa | Tecnología | Versiones declaradas en `package.json` |
|------|------------|----------------------------------------|
| UI | React | `^19.0.0` |
| UI | react-dom | `^19.0.0` |
| Enrutamiento | react-router-dom | `^7.14.2` |
| Build / dev server | Vite | `^6.2.0` |
| Plugin React | @vitejs/plugin-react | `^5.0.4` |
| Estilos | Tailwind CSS | `^4.1.14` |
| Integración Vite | @tailwindcss/vite | `^4.1.14` |
| Datos cliente | @tanstack/react-query | `^5.100.6` |
| Backend BaaS | @supabase/supabase-js | `^2.49.8` |
| Servidor HTTP (dev y prod según `server.ts`) | express | `^4.21.2` |
| Carga de archivos (servidor) | multer | `^1.4.5-lts.1` |
| Parser correo (servidor) | mailparser | `^3.9.8` |
| ZIP (servidor) | jszip | `^3.10.1` |
| HTTP cliente (servidor) | axios | `^1.15.2` |
| IA (servidor, rutas `/api/ai/*` y plantilla docx) | openai | `^6.35.0` |
| Dependencia declarada sin uso en `src/` revisado | @google/genai | `^1.50.1` |
| Formularios | react-hook-form | `^7.73.1` |
| Validación | zod | `^4.3.6` |
| Resolvers | @hookform/resolvers | `^5.2.2` |
| Rich text | TipTap (`@tiptap/*`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/html`, `@tiptap/starter-kit` y extensiones listadas) | `^3.22.5` |
| Word | docx, docxtemplater, mammoth, pizzip | `^9.5.0`, `^3.68.6`, `^1.12.0`, `^3.2.0` |
| Vista previa Word en navegador | docx-preview | `^0.3.7` |
| PDF | pdf-lib, pdfjs-dist, react-pdf, html2pdf.js | `^1.17.1`, `^5.4.296`, `^10.4.1`, `^0.14.0` |
| Fechas | date-fns, date-holidays | `^4.1.0`, `^3.27.0` |
| UI / iconos | lucide-react, motion, clsx, tailwind-merge | versiones en `package.json` |
| Markdown en UI | react-markdown | `^10.1.0` |
| UUID | uuid | `^14.0.0` |
| Ejecución TS en Node | tsx | `^4.21.0` (devDependency) |
| Lenguaje | TypeScript | `~5.8.2` |
| ORM (declarado, ver §1.4) | prisma | `^7.8.0` (devDependency) |

**Nombre del paquete npm:** el campo `"name"` en `package.json` es `"react-example"` (no `tutelia`).

**Entrada HTML:** `index.html` define `<title>My Google AI Studio App</title>` y `lang="en"`.

### 1.2 Estructura principal de carpetas y archivos

- **`src/`** — aplicación React (~109 archivos `.ts`/`.tsx` bajo `src/` según conteo en disco).
  - **`src/pages/`** — pantallas enrutadas: `Dashboard`, `NewCase`, `CasesList`, `CaseDetail`, `Estadisticas`, `Plantillas`, `Settings`, `Team`.
  - **`src/components/`** — UI modular (`layout`, `expediente`, `plantillas`, `settings`, `expedientes`, etc.).
  - **`src/lib/`** — lógica de dominio, consultas Supabase, generación de documentos, utilidades.
  - **`src/hooks/`** — p. ej. invalidación React Query ante Realtime.
  - **`src/contexts/`** — `CourtOperationalContext` (CUI, `process_definitions`, equipo); `SessionCourtContext` (court activo).
  - **`src/services/`** — `geminiService.ts` (nombre histórico; llama a API interna OpenAI, ver §2).
- **`server.ts`** (raíz) — Express: APIs `/api/*`, integración Vite en desarrollo, estáticos `dist/` en producción.
- **`docx-plantilla-server.ts`** — utilidades servidor para `.docx` e IA (importado solo desde `server.ts`).
- **`pdf-acta-detect.ts`** — detección de acta de reparto en PDF (usado desde `server.ts`).
- **`supabase/migrations/`** — **64** archivos SQL numerados (esquema Postgres + RLS + Storage + workflow + SGDE + SIERJU + civil CGP).
- **`scripts/`** — utilidades Node (`*.mts`) y `extract-protocolo-pdf.py`.
- **`docs/`** — documentación Markdown del proyecto (incl. resumen de protocolo expediente).
- **`prisma/`** — `schema.prisma` mínimo (ver §1.4).
- **`prisma.config.ts`** — apunta a `prisma/schema.prisma` y `DATABASE_URL`.
- **`firebase-blueprint.json`**, **`security_spec.md`**, **`metadata.json`** — metadatos / especificación; **no** hay imports de Firebase en `src/` (búsqueda `firebase|firestore` sin resultados en `src/`).

### 1.3 Organización de la base de datos y tecnología

- **Motor:** PostgreSQL gestionado vía **Supabase** (PostgREST + Auth + Storage + Realtime opcional).
- **Definición del esquema:** única fuente aplicable en repo = migraciones SQL en `supabase/migrations/*.sql`.
- **Cliente aplicación:** `@supabase/supabase-js` con URL y anon key desde variables `VITE_SUPABASE_*` o `NEXT_PUBLIC_SUPABASE_*` (`src/lib/supabase.ts`, `vite.config.ts` con `envPrefix: ['VITE_', 'NEXT_PUBLIC_']`).
- **Buckets Storage (creados en SQL):**
  - `case-documents` — adjuntos por expediente; `file_size_limit` 52428800 en migración.
  - `document-templates` — plantillas `.docx` subidas; límite 15728640 en migración.

### 1.4 Prisma

- Existe `prisma/schema.prisma` con `generator client` (output `../src/generated/prisma`) y `datasource db { provider = "postgresql" }` **sin URL en el archivo leído**.
- `prisma.config.ts` referencia `process.env["DATABASE_URL"]`.
- **No** se encontró uso de `@prisma/client` ni carpeta `src/generated/prisma` en el flujo principal de la app React (la app usa Supabase JS, no Prisma, para datos en tiempo de ejecución del front).

---

## 2. Módulos implementados

Descripción basada en rutas (`src/App.tsx`), páginas y librerías enlazadas. Estado: **completo** = flujo principal persistido en Supabase con UI; **parcial** = parte real y parte UI fija, demo o limitada; **simulado / placeholder** = texto o botón sin integración real documentada en código.

| Módulo | Ubicación principal | Qué hace (literal al comportamiento en código) | Estado |
|--------|---------------------|-----------------------------------------------|--------|
| Shell y autenticación | `src/components/layout/Shell.tsx` | Pantalla de login: Google/Microsoft OAuth (`signInWithOAuth`), o formulario local `admin`/`admin` que llama `signInWithPassword` con email `admin@tutelia.local` (`dev-admin-auth.ts`). Hidrata perfil desde tabla `profiles` o hace upsert. Persistencia en `localStorage` bajo clave `tutelia_mock_user` (nombre «mock» en código). Si no hay sesión Supabase y el usuario guardado es `local-*`, intenta anónimo; si falla, modo `localModeWithoutSupabase` con aviso de que no podrá guardar en BD. | Parcial (modo local explícito sin JWT) |
| Contexto despacho | `src/contexts/SessionCourtContext.tsx` | `courtId` desde perfil o `DEFAULT_DEMO_COURT_ID` (`court-1`). | Completo |
| Dashboard | `src/pages/Dashboard.tsx` | Lista expedientes del `courtId` vía `fetchCourtCasesForList`, métricas (activos, críticos, firma pendiente, conteo `sgdeId` no vacío), semáforo según días hábiles. Suscripción Realtime `cases` por `court_id`. | Completo (depende de Supabase + publicación Realtime si se desea tiempo real) |
| Nueva tutela / radicación | `src/pages/NewCase.tsx` + `server.ts` | Parseo `.eml` por `POST /api/parse-email`; opcional análisis `POST /api/ai/legal-analysis` con PDF base64; generación radicado; `insert` en `cases`, adjuntos en Storage + filas `case_documents`, acción `case_actions` si hay asignación, notificaciones si aplica, actualización cursor reparto `alternating`. | Completo (requiere servidor para parse/IA y sesión Supabase válida para persistir) |
| Lista expedientes | `src/pages/CasesList.tsx` | Tablero Kanban / lista / calendario (`ExpedientesViews`), mismos datos que modelo expediente + plazos. | Completo |
| Detalle expediente | `src/pages/CaseDetail.tsx` | Carga caso, documentos, actuaciones; cambio estado; campos legales/SIERJU; síntesis vía `summarizeCase` → `/api/ai/summarize`; paneles expediente digital, despacho (Word/PDF), revisiones Word, historial técnico `case_audit_log` + Realtime opcional. | Parcial (texto SGDE fijo en cabecera, ver §6) |
| Estadísticas SIERJU | `src/pages/Estadisticas.tsx` | Consulta `cases` del despacho y muestra agregados; tabla `SIERJU_TUTELAS_COBERTURA` documenta explícitamente qué filas del formulario oficial **no** están modeladas (ver §5). | Parcial |
| Plantillas y membrete | `src/pages/Plantillas.tsx`, `src/lib/plantillas-store.ts`, `src/lib/document-templates.ts` | Catálogo `document_templates` en Supabase; membrete en `localStorage` (`tutelia_plantillas_v1`); editores TipTap; importación `.docx` con APIs `/api/plantilla-docx/*`. | Completo (membrete local + plantillas BD/Storage) |
| Configuración | `src/pages/Settings.tsx` | Reparto sustanciador (`courts.sustanciador_*`), credenciales **SGDE por usuario** (`saveSgdeCredentials`, estado conexión). | Completo (SGDE usuario) |
| Sincronización SGDE | `src/pages/SgdeSync.tsx`, `ImportFromSgde.tsx`, `server/sgde-routes.ts` | Rutas `/sgde`, `/import-sgde`; sync documentos y metadatos expediente. | Completo (requiere credenciales) |
| Procesos civiles | `src/pages/ProcesosCivilesList.tsx`, pipelines CGP | Listado y radicación civil (`civil_ordinario`, `civil_ejecutivo`, etc.). | Parcial (expansión activa) |
| Correo / Outlook | `src/pages/Correo.tsx`, `CorreoPendientes.tsx` | Bandeja, clasificación, vínculo expediente. | Completo (requiere Outlook conectado) |
| Carril etapas | `CaseStagesExperience.tsx`, `case-stages-service.ts` | Tutela y civil con plazos D. 2591 / CGP. | Completo tutela; parcial civil |
| Equipo | `src/pages/Team.tsx` | Intenta `rpc('court_team_members')`; si falla, `profiles` filtrados por `court_id`. Fusiona con catálogo fijo `DESPACHO_STAFF` en `court-staff-assignees.ts`. | Completo (con fallback y catálogo semilla) |
| Notificaciones asignación | `src/components/layout/AssignmentNotificationBell.tsx`, `src/lib/assignment-notifications.ts` | Tabla `user_notifications`. | Completo (según implementación en lib citada) |
| Servicios IA cliente | `src/services/geminiService.ts` | `summarizeCase` hace `fetch('/api/ai/summarize')` — **no** importa `@google/genai`. | Completo (nombre archivo engañoso) |

**Rutas SGDE:** `App.tsx` define `<Route path="/sgde" element={<SgdeSync />} />` y `/import-sgde`. Menú en `Shell.tsx` / sidebar apunta a `/sgde`.

---

## 3. Modelos de datos

### 3.1 Tablas PostgreSQL (`public`) — según migraciones SQL

#### `courts`

- **PK:** `id` (text).
- **Campos:** `name`, `email`, `city`, `updated_at`; migraciones añaden `branding` (jsonb), `sustanciador_assignment_mode` (text con check), `sustanciador_rr_cursor` (smallint 0|1).
- **Relación:** referenciada por `profiles.court_id`, `cases.court_id`, `document_templates.court_id`, `user_notifications.court_id`.

#### `profiles`

- **PK:** `id` (uuid, FK `auth.users`).
- **Campos:** `email`, `name`, `role` (text, default `admin`), `court_id` (FK `courts`), `updated_at`.
- **Relación:** pertenece a un `court`.

#### `cases`

- **PK:** `id` (uuid, default `gen_random_uuid()` en inserciones desde app también se envía `id` explícito en `NewCase.tsx`).
- **Campos principales:** `court_id`, `radicado`, `claimant`, `defendant`, `status`, `subject`, `source_channel`, `raw_text`, `raw_html`, `summary`, datos legales (`claimant_id`, `claimant_email`, `defendant_id`, `defendant_email`, `legal_hechos`, `legal_pretensiones`, `legal_derecho_tutelado`, `legal_identificaciones`), `email_metadata` (jsonb), `operational_status`, `assigned_to`, `deadline_at`, `sgde_id`, timestamps; migraciones añaden `expediente_cuadernos_extra` (jsonb), `informe_ingreso_registrado_at`, `informe_ingreso_document_id` (FK opcional a `case_documents`), `derecho_tutelado_code`, `decision_type` (con checks), `deadline_override_note`.
- **Unicidad:** `unique (court_id, radicado)`.
- **Relación:** muchos `case_documents`, `case_actions`, `case_word_reviews`, `user_notifications`, `case_audit_log`.

#### `case_documents`

- **PK:** `id` (uuid).
- **Campos:** `case_id` (FK), `name`, `original_name`, `type`, `content_type`, `content`, `size`, `is_from_link`, `sort_order`, `error`, `created_at`; migraciones añaden `storage_path`, `notebook_code` (default `PI_C01_PRINCIPAL`).
- **Relación:** pertenece a `cases`; referenciada por `case_word_reviews.word_document_id` y `signed_pdf_document_id`, y por `cases.informe_ingreso_document_id`.

#### `case_actions`

- **PK:** `id` (uuid).
- **Campos:** `case_id`, `type`, `description`, `user_id` (FK auth.users nullable), `user_name`, `metadata` (jsonb), `created_at`.

#### `document_templates`

- **PK:** `id` (uuid).
- **Campos:** `court_id`, `categoria` (check `despacho|secretaria`), `tipo` (check `informe_ingreso|auto_admisorio|libre`), `nombre`, `descripcion`, `contenido_base`, `sort_order`, timestamps; migraciones añaden `docx_storage_path`, `docx_mapeo` (jsonb), `template_toggles` (jsonb), `page_layout` (jsonb).
- **RLS:** políticas por mismo `court_id` que el perfil (`document_templates_*_same_court`).

#### `user_notifications`

- Campos en migración: `id`, `court_id`, `case_id`, `recipient_user_id`, `kind`, `title`, `body`, `read_at`, `created_at`, `metadata`.

#### `case_word_reviews`

- Campos: `id`, `case_id`, `word_document_id`, `status` (check de cuatro valores), `judge_notes`, `sustanciador_reply`, `signed_pdf_document_id`, `created_by`, timestamps; migración añade `review_markup_json` (jsonb).

#### `case_audit_log`

- Campos: `id`, `case_id`, `occurred_at`, `actor_user_id`, `source_table`, `operation` (check INSERT|UPDATE|DELETE), `row_id`, `payload` (jsonb).
- **Población:** triggers en `cases`, `case_documents`, `case_actions`, `case_word_reviews`, `user_notifications` (definidos en migración).

### 3.2 Funciones RPC SQL en repo

- `public.handle_new_user` — trigger tras insert en `auth.users` para crear fila en `profiles` con `court_id = 'court-1'`.
- `public.court_team_members` — security definer; lista perfiles del mismo `court_id` que el usuario autenticado.

### 3.3 Tipos de aplicación (`src/types.ts`)

Interfaces TypeScript que reflejan las tablas anteriores (`Case`, `Document`, `Action`, `UserProfile`, `DocumentTemplate`, `CaseWordReview`, `CaseAuditLogEntry`, `Court`) más enums (`CaseStatus`, `UserRole`, `WordReviewStatus`, `SustanciadorAssignmentMode`, etc.). Los mapeos fila → tipo están en `src/lib/supabase-mappers.ts` y `src/lib/document-templates.ts` (`rowToTemplate`).

### 3.4 Catálogo estático de personal (no es tabla)

`src/lib/court-staff-assignees.ts` define `DESPACHO_STAFF` y `SUSTANCIADORES` con nombres y correos `@tutelia-despacho.seed` usados para UI de asignación y fusión en página Equipo. La migración SQL `20250429320000_courts_sustanciador_reparto.sql` incluye **nombres literales** de sustanciadores al backfill de `cases.assigned_to`.

---

## 4. Flujos implementados (paso a paso según código)

### 4.1 Arranque de la aplicación

1. **Desarrollo:** `npm run dev` ejecuta `tsx server.ts` (`package.json`).
2. `server.ts` carga `.env` / `.env.local`, monta Express, registra rutas `/api/*`, en `NODE_ENV !== 'production'` integra middleware de Vite SPA.
3. El navegador carga `index.html` → `src/main.tsx` → `QueryClientProvider` → `App` con `BrowserRouter`.

**Fin:** usuario ve `Shell` (login o aplicación).

### 4.2 Autenticación y sesión

1. Si faltan variables Supabase → mensaje de configuración (`Shell.tsx`).
2. Si hay sesión Supabase → carga `profiles` y muestra app.
3. Si no hay sesión pero hay `tutelia_mock_user` con uid `local-*` → intento `signInAnonymously`; si falla por políticas locales → `localModeWithoutSupabase` y perfil en memoria con `court-1`.

**Fin:** `SessionCourtProvider` recibe `profile` o `null` (según ramas).

### 4.3 Radicación desde correo (Nueva tutela)

1. Usuario sube `.eml` → `POST /api/parse-email` (`server.ts`): parseo `mailparser`, descarga opcional enlace «Archivo», descomprime ZIP, clasifica nombres, sesión temporal `parseSessions` con GET `/api/parse-session/:id/attachment/:index`.
2. Opcional: PDF demanda → `POST /api/ai/legal-analysis` con `pdfBase64` y prompt construido en cliente (`NewCase.tsx`).
3. Usuario confirma → cliente genera `caseId` (UUID), consulta duplicado `(court_id, radicado)`, lee `courts` para modo reparto, calcula `assigned_to` y `deadline_at` (10 días hábiles — lógica en `business-days` usada desde `NewCase.tsx`).
4. `insert` en `cases`; construcción de filas `case_documents` (correo metadata + adjuntos: subida Storage cuando hay bytes válidos).
5. Si modo `alternating`, `update` de `courts.sustanciador_rr_cursor`.
6. Si hubo `assigned_to`, `insert` en `case_actions` y notificaciones (`insertAssignmentNotificationsForProfiles`).
7. Limpieza borrador `localStorage` clave definida en `NewCase.tsx`; resultado muestra radicado y enlace al expediente.

**Inicio:** `/new`. **Fin:** expediente persistido en Supabase o error con rollback parcial (el código elimina objeto Storage y caso si falla insert documentos).

### 4.4 Listado y tablero de expedientes

1. `CasesList` / `Dashboard` llaman `fetchCourtCasesForList(courtId, orderColumn)` (`court-cases-query.ts`).
2. Filas mapeadas a `Case` → `buildExpedienteViewRow` (`expedientes-view-model.ts`) para columnas Kanban y plazos.
3. Realtime: `useInvalidateCourtCasesOnRealtime` invalida queries ante cambios en `public.cases` con filtro `court_id`.

**Inicio:** `/` o `/cases`. **Fin:** vista actualizada desde caché React Query.

### 4.5 Detalle de expediente (operación típica)

1. Ruta `/case/:id` → carga caso por id, documentos, acciones, revisiones Word, audit log (consultas Supabase en `CaseDetail.tsx`).
2. Cambio de estado desde `<select>` → insert en `case_actions` + update `cases.status`.
3. «Analizar con IA» → `summarizeCase` → `POST /api/ai/summarize` → OpenAI → opcional persistencia de `summary` en caso (según handlers en el mismo archivo; la llamada a servicio existe en imports).

**Inicio:** `/case/:id`. **Fin:** datos mostrados/actualizados en Supabase.

### 4.6 Plantillas documentales

1. `fetchDocumentTemplates` / CRUD en `document-templates.ts` contra tabla `document_templates`.
2. Generación de `.docx` / PDF en cliente vía librerías en `src/lib/` (p. ej. `generate-judicial-docx.ts`, `informe-docx-to-pdf.ts`, etc., según paneles que importe `CaseDetail` / `Plantillas`).
3. Subida de plantilla `.docx` al bucket `document-templates` donde el flujo lo implementa (paneles de importación).

**Inicio:** `/plantillas` o acciones dentro del expediente. **Fin:** filas/buckets actualizados o descarga de archivo.

### 4.7 Informe de ingreso al expediente (flujo documentado en código)

`registerCaseInformeIngresoWithExpedientePdf` (`document-templates.ts`): sube PDF a Storage, inserta `case_documents`, actualiza `cases.informe_ingreso_registrado_at` e `informe_ingreso_document_id`.

### 4.8 Borrador Word con ciclo de revisión

`uploadGeneratedDocxToExpedienteWithWordReview` (`document-templates.ts`): sube `.docx`, inserta `case_documents`, crea fila `case_word_reviews`, inserta notificaciones al juez (`word-review-notifications.ts`).

### 4.9 Scripts de mantenimiento (Node)

- `npm run seed:dev-admin` — crea usuario Auth de desarrollo (requiere service role en entorno local, ver comentarios en script).
- `npm run seed:court-users` — seed de equipo (archivo no detallado línea a línea en este informe; existe en repo).
- `npm run verify:supabase` — verificación de conectividad/env.
- `npm run supabase:ensure-case-documents`, `npm run backfill:case-deadlines`, `npm run analyze:eml` — existen en `package.json` y apuntan a `scripts/*.mts`.

---

## 5. Lo que NO está implementado o está incompleto (explícito en código o ausente de rutas)

| Tema | Evidencia en código |
|------|---------------------|
| Página «Sincronización SGDE» (`/sgde`) | **Implementada** — `SgdeSync.tsx`, `App.tsx` L59. |
| Interconexión SGDE operativa | **Implementada** — `Settings.tsx` guarda credenciales por usuario; `server/sgde-*.ts` sincroniza. Requiere `SGDE_ENCRYPTION_KEY` y credenciales Rama. |
| Referencia SGDE en cabecera del expediente | Verificar en `CaseDetail.tsx` si aún hay texto fijo vs `case.sgde_id` (puede variar por versión). |
| Integración `@google/genai` / Gemini en runtime | Dependencia en `package.json`; **ningún** import en `src/` encontrado por búsqueda; síntesis usa OpenAI en servidor. |
| Cobertura completa formulario SIERJU | `Estadisticas.tsx` array `SIERJU_TUTELAS_COBERTURA` marca varios bloques como `no` o `parcial`. |
| Inventario inicial/final SIERJU | Mismo array: estado `no`. |
| Acumulación de procesos | Mismo array: «No hay campo ni regla». |
| Tipos de entrada (reingreso, competencia, impedimentos) | Mismo array: `no` o no modelados. |
| Métricas de salida finas | Parcial: depende de `decision_type` y fechas proxy (`updated_at` mencionado en comentarios del array). |
| Plazos tutela (D. 2591/91) | `src/lib/decreto-2591-plazos.ts`, `docs/decreto-2591-plazos-tutela.md`: art. 29 (10 háb.), art. 31 (3 háb. impugnación), art. 32 (20 háb. 2ª instancia). Tablero sin «(demo)». |
| Vista previa local sustitución marcadores DOCX | `DocxPlantillaImportSection.tsx`: función `simularTextoLocal` — simulación en cliente para vista previa, no reemplaza el flujo servidor de `aplicar`. |
| Prisma como capa de acceso en la app | Esquema mínimo; aplicación no usa cliente Prisma en `src/` para CRUD. |
| Políticas RLS restrictivas por tribunal en todas las tablas | `security_spec.md` y migraciones iniciales: `cases`, `case_documents`, `case_actions`, `case_word_reviews` con políticas **authenticated** amplias; `document_templates` y `case_audit_log` más acotadas; comentarios SQL piden «endurecer» en el futuro. |
| Limpieza automática Storage al borrar caso | Comentarios en migraciones `case_documents_storage` y `case-document-storage.ts`: huérfanos posibles; mitigación descrita como futura (Edge Function/job), no implementada en el fragmento revisado. |
| Ley 2213 en notificaciones | Resumen en `docs/ley-2213-notificaciones-resumen.md`; **runtime F2 pendiente** (`notification_records`). |
| Normativa consolidada en repo | `docs/normativa/full_text/` (CGP, 2213, Código Civil) — jul 2026. |
| PDF/A obligatorio | Documentado en `docs/protocolo-gestion-documentos-electronicos-resumen.md` como mejora futura; no es lógica de validación en runtime. |

---

## 6. Problemas conocidos, deuda técnica e inconsistencias

### 6.1 Seguridad y documentación cruzada

- **`security_spec.md`** describe invariantes (p. ej. acceso restringido por `courtId`, inmutabilidad de `radicado` tras admisión) y menciona `isValidId(id)` — **no** aparece `isValidId` en `src/` (búsqueda sin resultados). La especificación **no coincide** del todo con el comportamiento RLS actual en migraciones (acceso `authenticated` amplio en varias tablas).
- **Nombre de archivo `geminiService.ts`:** mensajes de error hablan de «OpenAI» y «Cuota de OpenAI» mientras el nombre del archivo sugiere Gemini (`src/services/geminiService.ts`).

### 6.2 UX / producto

- **Menú SGDE** → ruta `/sgde` registrada en `App.tsx`.
- **Referencia SGDE** visible al usuario es estática y no refleja `sgde_id` de la base.
- **`index.html`:** título genérico «My Google AI Studio App» en lugar de marca Tutelia.

### 6.3 Empaquetado y nombres

- **`package.json` `name`:** `react-example` en lugar de identificador del producto.
- **Dependencia `@google/genai`:** instalada pero sin uso detectado en `src/`; aumenta superficie y confusión respecto a README que menciona `GEMINI_API_KEY`.

### 6.4 Modo sin Supabase

- Con `localModeWithoutSupabase`, la UI advierte que no se podrá guardar en BD; el usuario aún puede ver layout — riesgo de expectativa vs persistencia.

### 6.5 Realtime

- Comentarios en migraciones SQL indican que hay que **añadir tablas manualmente** a la publicación `supabase_realtime` para recibir eventos; sin eso, las suscripciones en código pueden no recibir cambios (depende de configuración del proyecto Supabase, no del solo repo).

---

## 7. Limitaciones de este documento

- No se ejecutaron tests E2E en esta auditoría; **`npm run build` exitoso** (jul 2026).
- No se revisó cada línea de los ~2000+ líneas de `CaseDetail.tsx` ni de todos los componentes: los flujos descritos se basan en imports, rutas, SQL y lectura parcial sistemática de archivos clave.
- Comportamiento exacto de cada handler en `CaseDetail.tsx` (todas las pestañas) puede incluir ramas adicionales no enumeradas aquí.

---

*Fin del informe.*
