/**
 * Verifica si las migraciones de mayo 2026 ya están aplicadas en Supabase:
 * - 20260526120000_profiles_superuser.sql
 * - 20260527120000_case_document_ai_analyses.sql
 *
 * Uso: npm run verify:migrations-202605
 *
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en .env (o .env.local).
 * Opcional: DATABASE_URL / DIRECT_URL + paquete `pg` para comprobación SQL completa
 * (políticas, índices, triggers). Sin `pg`, usa solo el cliente Supabase (service role).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const MIGRATION_FILES = [
  'supabase/migrations/20260526120000_profiles_superuser.sql',
  'supabase/migrations/20260527120000_case_document_ai_analyses.sql',
] as const;

type Check = { id: string; ok: boolean; detail: string };

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function loadEnv() {
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    dotenv.config({ path: full, override: true });
  }
}

function envUnset(v: string | undefined) {
  return v === undefined || String(v).trim() === '';
}

function normalizeSupabaseUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s;
}

const SQL_CATALOG = `
SELECT check_name, ok::text AS ok
FROM (
  SELECT 'profiles.is_superuser' AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_superuser'
    ) AS ok
  UNION ALL
  SELECT 'function.auth_is_superuser',
    EXISTS (
      SELECT 1 FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'auth_is_superuser'
    )
  UNION ALL
  SELECT 'policy.cases_select_superuser',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'cases' AND policyname = 'cases_select_superuser'
    )
  UNION ALL
  SELECT 'case_documents.file_hash',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'case_documents' AND column_name = 'file_hash'
    )
  UNION ALL
  SELECT 'table.case_document_ai_analyses',
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'case_document_ai_analyses'
    )
  UNION ALL
  SELECT 'index.case_document_ai_analyses_doc_uidx',
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'case_document_ai_analyses'
        AND indexname = 'case_document_ai_analyses_doc_uidx'
    )
  UNION ALL
  SELECT 'trigger.case_document_ai_analyses_check_case_trg',
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'case_document_ai_analyses_check_case_trg'
        AND NOT tgisinternal
    )
  UNION ALL
  SELECT 'rls.case_document_ai_analyses',
    COALESCE((
      SELECT c.relrowsecurity
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'case_document_ai_analyses'
    ), false)
  UNION ALL
  SELECT 'policy.case_document_ai_analyses_select_same_court',
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'case_document_ai_analyses'
        AND policyname = 'case_document_ai_analyses_select_same_court'
    )
) q
ORDER BY check_name;
`;

loadEnv();

const supabaseUrl = normalizeSupabaseUrl(
  process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    ''
);
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const databaseUrl = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim() || '';

function printHeader() {
  console.log('Verificación migraciones mayo 2026 (superuser + lectura IA)');
  console.log('Raíz:', projectRoot);
  console.log('Archivos esperados:');
  for (const f of MIGRATION_FILES) console.log('  -', f);
  console.log('');
}

async function checkViaSupabaseClient(): Promise<Check[]> {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const out: Check[] = [];

  function isNetworkError(message: string) {
    return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|certificate|UNABLE_TO_VERIFY/i.test(message);
  }

  async function column(table: string, column: string, migrationHint: string) {
    const { error } = await sb.from(table).select(column).limit(1);
    if (error) {
      if (isNetworkError(error.message)) {
        out.push({
          id: `${table}.${column}`,
          ok: false,
          detail: `red/TLS: ${error.message} → use el .sql en SQL Editor o revise proxy/firewall`,
        });
        return;
      }
      const missing =
        error.code === 'PGRST204' ||
        error.code === '42703' ||
        /column.*does not exist/i.test(error.message) ||
        /Could not find the '.*' column/i.test(error.message);
      out.push({
        id: `${table}.${column}`,
        ok: false,
        detail: missing ? `falta → ${migrationHint}` : error.message,
      });
      return;
    }
    out.push({ id: `${table}.${column}`, ok: true, detail: 'OK (columna visible con service_role)' });
  }

  await column('profiles', 'is_superuser', MIGRATION_FILES[0]);
  await column('case_documents', 'file_hash', MIGRATION_FILES[1]);

  const { error: aiTableErr } = await sb.from('case_document_ai_analyses').select('id').limit(1);
  if (aiTableErr) {
    if (isNetworkError(aiTableErr.message)) {
      out.push({
        id: 'table.case_document_ai_analyses',
        ok: false,
        detail: `red/TLS: ${aiTableErr.message} → use el .sql en SQL Editor`,
      });
    } else {
    const missing =
      aiTableErr.code === 'PGRST205' ||
      aiTableErr.code === '42P01' ||
      /relation.*does not exist/i.test(aiTableErr.message) ||
      /Could not find the table/i.test(aiTableErr.message);
    out.push({
      id: 'table.case_document_ai_analyses',
      ok: false,
      detail: missing ? `falta → ${MIGRATION_FILES[1]}` : aiTableErr.message,
    });
    }
  } else {
    out.push({
      id: 'table.case_document_ai_analyses',
      ok: true,
      detail: 'OK (tabla accesible con service_role)',
    });
  }

  const { error: rpcErr } = await sb.rpc('auth_is_superuser');
  if (rpcErr) {
    if (isNetworkError(rpcErr.message)) {
      out.push({
        id: 'function.auth_is_superuser',
        ok: false,
        detail: `red/TLS: ${rpcErr.message} → use el .sql en SQL Editor`,
      });
    } else {
    const missing =
      rpcErr.code === 'PGRST202' ||
      /function.*does not exist/i.test(rpcErr.message) ||
      /Could not find the function/i.test(rpcErr.message);
    out.push({
      id: 'function.auth_is_superuser',
      ok: false,
      detail: missing ? `falta → ${MIGRATION_FILES[0]}` : rpcErr.message,
    });
    }
  } else {
    out.push({
      id: 'function.auth_is_superuser',
      ok: true,
      detail: 'OK (función expuesta vía RPC)',
    });
  }

  return out;
}

async function checkViaPg(): Promise<Check[] | null> {
  if (envUnset(databaseUrl)) return null;
  if (databaseUrl.startsWith('prisma+')) {
    console.log('DATABASE_URL es prisma+: omitiendo comprobación SQL directa.\n');
    return null;
  }

  let Client: typeof import('pg').Client;
  try {
    ({ Client } = await import('pg'));
  } catch {
    console.log(
      'Paquete `pg` no instalado: comprobación SQL completa omitida.',
      'Instale con `npm install pg` o ejecute scripts/sql/verify-migrations-20260526-27.sql en el SQL Editor.\n'
    );
    return null;
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query<{ check_name: string; ok: string }>(SQL_CATALOG);
    return res.rows.map((row) => ({
      id: row.check_name,
      ok: row.ok === 'true' || row.ok === 't',
      detail: row.ok === 'true' || row.ok === 't' ? 'OK (catálogo Postgres)' : 'NO aplicado',
    }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

function printChecks(title: string, checks: Check[]) {
  console.log(title);
  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? '✓' : '✗';
    console.log(`  ${mark} ${c.id}`);
    if (!c.ok) {
      allOk = false;
      console.log(`      → ${c.detail}`);
    }
  }
  console.log('');
  return allOk;
}

printHeader();

if (envUnset(supabaseUrl) || envUnset(serviceRoleKey)) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env');
  console.error('Sin service_role no se puede verificar el esquema de forma fiable.');
  process.exit(1);
}

let exitCode = 0;

try {
  const clientChecks = await checkViaSupabaseClient();
  const clientOk = printChecks('Comprobación vía Supabase (service_role):', clientChecks);
  if (!clientOk) exitCode = 1;

  const pgChecks = await checkViaPg();
  if (pgChecks) {
    const pgOk = printChecks('Comprobación SQL completa (pg + DATABASE_URL/DIRECT_URL):', pgChecks);
    if (!pgOk) exitCode = 1;
  } else if (exitCode === 0) {
    console.log(
      'Tip: para verificar políticas RLS, índices y triggers sin instalar `pg`,',
      'pegue y ejecute en Supabase → SQL Editor:',
      path.join(projectRoot, 'scripts', 'sql', 'verify-migrations-20260526-27.sql'),
      '\n'
    );
  }

  const networkOnly = clientChecks.every((c) => !c.ok && /red\/TLS/i.test(c.detail));
  if (networkOnly && !pgChecks) {
    console.log(
      'No se pudo contactar Supabase desde este equipo (red o certificado TLS).',
      'Verifique en el panel: SQL Editor →',
      path.join('scripts', 'sql', 'verify-migrations-20260526-27.sql'),
    );
    exitCode = 2;
  } else if (exitCode === 0) {
    console.log('Resultado: las migraciones de mayo 2026 parecen aplicadas correctamente.');
  } else {
    console.log('Resultado: faltan objetos. Ejecute las migraciones indicadas arriba.');
    console.log('  npm run db:apply-sql -- supabase/migrations/20260526120000_profiles_superuser.sql');
    console.log('  npm run db:apply-sql -- supabase/migrations/20260527120000_case_document_ai_analyses.sql');
  }
} catch (e) {
  console.error('Error:', e instanceof Error ? e.message : e);
  exitCode = 1;
}

process.exit(exitCode);
