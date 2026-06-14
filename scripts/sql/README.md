# SQL multi-tenant Tutelia

## Ejecutar en Supabase (recomendado)

1. Abre **Supabase Dashboard → SQL Editor → New query**
2. Pega el contenido completo de:
   **`supabase-multi-tenant-fase-a-b-completo.sql`**
3. Pulsa **Run** (una sola vez)
4. Opcional — verificación:
   ```bash
   npm run verify:multi-tenant
   ```
   (requiere `DATABASE_URL` en `.env` y paquete `pg`)

## Archivos por fase

| Orden | Archivo migración | Contenido |
|-------|-------------------|-----------|
| 1 | `20260613120000_platform_admins.sql` | platform_admins, is_platform_admin, audit log |
| 2 | `20260613130000_courts_platform_fields.sql` | courts.status, pg_trgm, CUI |
| 3 | `20260613140000_rls_helpers_unified.sql` | current_court_id, auth_user_has_court/case |
| 4 | `20260613150000_rls_macro_apply_court.sql` | apply_court_rls_policies macro |
| 5 | `20260613160000_rls_apply_court_policies_all.sql` | RLS unificado en tablas operativas |
| 6 | `20260614120000_bulk_import_courts.sql` | RPC `bulk_upsert_courts`, índice CUI único |
| 7 | `20260614150000_platform_regional_admins.sql` | Delegación consola por territorio |

## Fase E — import CSV

```bash
# Tras aplicar migración 20260614120000 en SQL Editor:
npm run bulk:import-courts -- scripts/samples/courts-import-template.csv
npm run bulk:import-courts -- ruta.csv --dry-run
```

Plantilla de columnas: `scripts/samples/courts-import-template.csv`

## Después del SQL

```bash
npm run seed:superuser
```

## Alternativa CLI

```bash
supabase db push
```
