/**
 * Asegura el bucket «case-documents» y las políticas de Storage en tu proyecto Supabase.
 *
 * 1) Si existe DATABASE_URL o DIRECT_URL (Postgres directo): ejecuta la migración SQL del repo.
 * 2) Si no hay URL de DB pero sí SUPABASE_SERVICE_ROLE_KEY: crea el bucket vía API (sin políticas SQL).
 *
 * Uso: npm run supabase:ensure-case-documents
 *
 * Requiere en .env / .env.local (no commitear secretos):
 * - VITE_SUPABASE_URL o SUPABASE_URL
 * - DATABASE_URL o DIRECT_URL (recomendado para SQL)
 * - Opcional: SUPABASE_SERVICE_ROLE_KEY (fallback API)
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function loadMergedEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const dir of [projectRoot, path.resolve(process.cwd())]) {
    for (const name of ['.env', '.env.local'] as const) {
      const full = path.join(dir, name);
      if (!fs.existsSync(full)) continue;
      const parsed = dotenv.parse(stripBom(fs.readFileSync(full, 'utf8')));
      for (const [key, raw] of Object.entries(parsed)) {
        const t = typeof raw === 'string' ? raw.trim() : String(raw).trim();
        if (t !== '') merged[key] = t;
      }
    }
  }
  return merged;
}

function normalizeSupabaseUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s;
}

const env = loadMergedEnv();
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
const url = urlRaw ? normalizeSupabaseUrl(urlRaw) : '';
const databaseUrl = (env.DIRECT_URL || env.DATABASE_URL || '').trim();
const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const sqlPath = path.join(projectRoot, 'supabase', 'migrations', '20250428140000_case_documents_storage.sql');

function runSqlMigration(): boolean {
  if (!databaseUrl || databaseUrl.startsWith('prisma+')) {
    console.log('Sin DATABASE_URL/DIRECT_URL postgres: se omite ejecución SQL.');
    return false;
  }
  if (!fs.existsSync(sqlPath)) {
    console.error('No se encuentra:', sqlPath);
    return false;
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Ejecutando SQL vía Prisma (DATABASE_URL/DIRECT_URL)...');
  const r = spawnSync(
    'npx',
    ['prisma', 'db', 'execute', '--stdin', '--config', path.join(projectRoot, 'prisma.config.ts')],
    {
      cwd: projectRoot,
      input: sql,
      encoding: 'utf-8',
      shell: true,
      timeout: 120_000,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    }
  );
  if (r.status !== 0) {
    console.error('Prisma db execute stderr:', r.stderr || '(vacío)');
    console.error('Prisma db execute stdout:', r.stdout || '(vacío)');
    return false;
  }
  if (r.stdout?.trim()) console.log(r.stdout.trim());
  console.log('SQL de Storage aplicado correctamente.');
  return true;
}

async function ensureBucketViaApi(): Promise<boolean> {
  if (!url || !serviceKey) {
    console.error(
      'Sin DATABASE_URL no se pudo aplicar SQL. Añada SUPABASE_SERVICE_ROLE_KEY + URL para crear el bucket vía API, o configure DIRECT_URL (db.xxx.supabase.co:5432) y vuelva a ejecutar.'
    );
    return false;
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: buckets, error: listErr } = await admin.storage.listBuckets();
  if (listErr) {
    console.error('listBuckets:', listErr.message);
    return false;
  }
  if (buckets?.some((b) => b.id === 'case-documents')) {
    console.log('Bucket «case-documents» ya existe (API).');
    return true;
  }
  const { error: createErr } = await admin.storage.createBucket('case-documents', {
    public: false,
    fileSizeLimit: 52428800,
  });
  if (createErr) {
    console.error('createBucket:', createErr.message);
    return false;
  }
  console.log('Bucket «case-documents» creado vía API (50 MB, privado).');
  console.warn(
    'Atención: sin ejecutar el SQL de migración, pueden faltar políticas RLS en storage.objects. Configure DIRECT_URL y vuelva a ejecutar este script.'
  );
  return true;
}

let ok = false;
if (databaseUrl && !databaseUrl.startsWith('prisma+')) {
  ok = runSqlMigration();
}

if (!ok) {
  ok = await ensureBucketViaApi();
}

if (!ok) {
  console.error('\nNo se pudo asegurar Storage. Compruebe DIRECT_URL en .env.local (host db.<ref>.supabase.co:5432).');
  process.exit(1);
}

console.log('\nListo. Reinicie la radicación en la app.');
process.exit(0);
