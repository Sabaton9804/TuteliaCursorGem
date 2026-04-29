/**
 * Comprueba variables de Supabase / Postgres cargadas desde .env y .env.local (misma lógica que server.ts).
 * No imprime secretos.
 *
 * Variables reconocidas:
 * - SUPABASE_URL + SUPABASE_ANON_KEY → GET /rest/v1/
 * - VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (mismo uso)
 * - DATABASE_URL (postgres o prisma+postgres) → npx prisma db execute --stdin
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function envUnset(v: string | undefined) {
  return v === undefined || String(v).trim() === '';
}

function mergeEnvFiles() {
  const dirs = [projectRoot];
  const cwd = path.resolve(process.cwd());
  if (cwd !== projectRoot) dirs.push(cwd);
  const merged: Record<string, string> = {};
  for (const dir of dirs) {
    for (const name of ['.env', '.env.local'] as const) {
      const full = path.join(dir, name);
      if (!fs.existsSync(full)) continue;
      const parsed = dotenv.parse(stripBom(fs.readFileSync(full, 'utf8')));
      for (const [key, raw] of Object.entries(parsed)) {
        const t = typeof raw === 'string' ? raw.trim() : String(raw).trim();
        if (t !== '') merged[key] = t;
        else if (!(key in merged)) merged[key] = '';
      }
    }
  }
  for (const [key, val] of Object.entries(merged)) {
    if (val !== '' && envUnset(process.env[key])) process.env[key] = val;
  }
}

mergeEnvFiles();

function normalizeSupabaseProjectUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s;
}

const supabaseUrlRaw =
  process.env.SUPABASE_URL?.trim() ||
  process.env.VITE_SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  '';
const supabaseUrl = supabaseUrlRaw ? normalizeSupabaseProjectUrl(supabaseUrlRaw) : '';
const supabaseAnon =
  process.env.SUPABASE_ANON_KEY?.trim() ||
  process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  '';
const databaseUrl = process.env.DATABASE_URL?.trim() || '';
const directUrl = process.env.DIRECT_URL?.trim() || '';

console.log('Raíz del proyecto:', projectRoot);
console.log('cwd:', process.cwd());
console.log('SUPABASE_URL definida:', !envUnset(supabaseUrl));
console.log('SUPABASE_ANON_KEY (o alias) definida:', !envUnset(supabaseAnon));
console.log('DATABASE_URL definida:', !envUnset(databaseUrl));
console.log('DIRECT_URL definida:', !envUnset(directUrl));

async function testSupabaseRest() {
  const base = supabaseUrl;
  /** La raíz `/rest/v1/` a veces responde 401 con anon; probamos un recurso real. */
  const probe = `${base}/rest/v1/courts?select=id&limit=1`;
  const res = await fetch(probe, {
    method: 'GET',
    headers: {
      apikey: supabaseAnon,
      Authorization: `Bearer ${supabaseAnon}`,
      Accept: 'application/json',
    },
  });
  const ok = res.ok;
  console.log(`REST (${probe}): HTTP ${res.status} ${res.statusText} →`, ok ? 'conexión aceptada' : 'fallo');
  if (res.status === 404) {
    console.log('→ 404 suele indicar que la tabla «courts» no existe: ejecute la migración SQL del repo en Supabase.');
  }
  if (!ok) {
    const body = await res.text().catch(() => '');
    if (body.length < 500) console.log('Cuerpo:', body);
    if (res.status === 401 && body.includes('Invalid API key')) {
      console.log('→ Compruebe que NEXT_PUBLIC_SUPABASE_ANON_KEY sea la clave «anon» publicable, no la service_role.');
    }
  }
  return ok;
}

/** Comprueba que existan tablas del esquema Tutelia (tras ejecutar la migración SQL). */
async function testTuteliaTables(): Promise<boolean> {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });

  const { data: anonData, error: anonErr } = await sb.auth.signInAnonymously();
  if (anonErr) {
    console.log(
      'Sesión anónima no disponible (RLS exige authenticated):',
      anonErr.message,
      '→ Habilite Anonymous en Auth o ignore errores de tablas si solo probó REST.'
    );
  } else if (anonData.session) {
    console.log('Sesión anónima: OK (JWT para pruebas RLS).');
  }

  const tables = ['courts', 'profiles', 'cases', 'case_documents', 'case_actions'] as const;
  let ok = true;
  for (const t of tables) {
    const { error } = await sb.from(t).select('id').limit(1);
    if (error) {
      console.log(`Tabla «${t}»: ERROR`, error.code || '', error.message);
      ok = false;
    } else {
      console.log(`Tabla «${t}»: OK.`);
    }
  }

  const { data: court, error: ce } = await sb.from('courts').select('id,name').eq('id', 'court-1').maybeSingle();
  if (ce) {
    console.log('Consulta court-1:', ce.message);
    ok = false;
  } else if (court) {
    console.log('Registro court-1:', (court as { id: string }).id, '|', (court as { name?: string }).name || '');
  } else if (anonErr) {
    console.log(
      'Registro court-1: no visible con JWT anon (RLS solo «authenticated»). Tras migración el seed suele existir; habilite Anonymous o pruebe con sesión Google.'
    );
  } else {
    console.log('Registro court-1: no existe (ejecute supabase/migrations/20250428120000_tutelia_core.sql o use Configuración).');
    ok = false;
  }

  return ok;
}

function testPrismaPostgres(): boolean {
  if (envUnset(databaseUrl)) {
    console.log('Prisma/SQL: sin DATABASE_URL, se omite.');
    return false;
  }
  if (databaseUrl.startsWith('prisma+')) {
    console.log(
      'DATABASE_URL es prisma+ (Prisma Accelerate/Data Proxy). Prueba SQL omitida; use URL postgres directa de Supabase (Session mode) para `prisma db execute`.'
    );
    return true;
  }
  /** Prisma contra pooler (6543) a veces se cuelga; DIRECT_URL = db.<ref>.supabase.co:5432 es el recomendado. */
  const prismaConnUrl = !envUnset(directUrl) ? directUrl : databaseUrl;
  if (!envUnset(directUrl)) {
    console.log('Prisma/SQL: probando con DIRECT_URL (migraciones / SQL; suele ser sesión pooler o host db).');
  } else {
    console.log(
      'Prisma/SQL: probando con DATABASE_URL. Si tarda mucho o falla, añada DIRECT_URL (host db.<ref>.supabase.co:5432, usuario postgres).'
    );
  }
  const r = spawnSync(
    'npx',
    ['prisma', 'db', 'execute', '--stdin', '--config', path.join(projectRoot, 'prisma.config.ts')],
    {
      cwd: projectRoot,
      input: 'SELECT 1 as ok;',
      encoding: 'utf-8',
      shell: true,
      timeout: 25_000,
      env: { ...process.env, DATABASE_URL: prismaConnUrl },
    }
  );
  if (r.error) {
    const msg = r.error.message;
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      console.log('Prisma db execute: tiempo agotado (25s). Use DIRECT_URL a db.<ref>.supabase.co:5432.');
    } else {
      console.log('Prisma db execute error:', msg);
    }
    return false;
  }
  if (r.signal === 'SIGTERM') {
    console.log('Prisma db execute: proceso terminado por tiempo (25s). Revise DIRECT_URL / red / firewall.');
    return false;
  }
  if (r.status !== 0) {
    console.log('Prisma db execute stderr:', r.stderr || '(vacío)');
    console.log('Prisma db execute stdout:', r.stdout || '(vacío)');
    return false;
  }
  console.log('Prisma/SQL: SELECT 1 OK.');
  if (r.stdout?.trim()) console.log(r.stdout.trim());
  return true;
}

let code = 0;
try {
  if (supabaseUrl && supabaseAnon) {
    const okRest = await testSupabaseRest();
    if (!okRest) code = 1;
    const okSchema = await testTuteliaTables();
    if (!okSchema) code = 1;
  } else {
    console.log('Sin SUPABASE_URL + clave anónima: no se prueba REST de Supabase.');
  }

  if (databaseUrl) {
    if (databaseUrl.startsWith('prisma+')) {
      console.log(
        'DATABASE_URL es prisma+ (Accelerate/Proxy). Para probar Postgres de Supabase use la URI «Transaction» o «Session» (postgresql://...) del panel Database.'
      );
    } else {
      const okPrisma = testPrismaPostgres();
      if (!okPrisma) {
        console.log(
          '(Aviso) Prisma/SQL directo falló; la app web usa el cliente Supabase (anon + RLS). Revise DATABASE_URL / DIRECT_URL si usa Prisma aparte.'
        );
      }
    }
  }
} catch (e) {
  console.error('Error:', e instanceof Error ? e.message : e);
  code = 1;
}

if (!supabaseUrl && !supabaseAnon && !databaseUrl) {
  console.log('\nNo hay variables de Supabase ni DATABASE_URL. Añada en .env.local por ejemplo:');
  console.log('  SUPABASE_URL=https://xxxx.supabase.co');
  console.log('  SUPABASE_ANON_KEY=eyJ...');
  console.log('o DATABASE_URL=postgresql://... (cadena de conexión de Supabase → Database).');
  code = 1;
}

process.exit(code);
