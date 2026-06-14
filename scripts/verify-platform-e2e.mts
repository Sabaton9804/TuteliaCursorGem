/**
 * Verificación E2E consola plataforma (API + Supabase cliente).
 * Requiere: .env con Supabase + servidor en http://localhost:3000
 *
 * Uso: npx tsx scripts/verify-platform-e2e.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SUPERUSER_EMAIL } from '../src/lib/superuser-auth.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(fs.readFileSync(full, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      const t = String(v).trim();
      if (t) merged[k] = t;
    }
  }
  return merged;
}

const env = loadEnv();
const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const password = (env.SUPERUSER_PASSWORD || '123456').trim();
const baseUrl = (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

if (!url || !anonKey || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL, anon key o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const testCourtId = `court-e2e-${Date.now()}`;
const testCourtName = `E2E Verify ${new Date().toISOString().slice(0, 10)}`;

async function waitForServer(maxMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok || res.status === 304) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Servidor no respondió en ${baseUrl} tras ${maxMs}ms`);
}

async function main() {
  console.log('1/6 Esperando servidor…');
  await waitForServer();

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('2/6 Login superusuario…');
  const { data: signIn, error: signErr } = await client.auth.signInWithPassword({
    email: SUPERUSER_EMAIL,
    password,
  });
  if (signErr || !signIn.session?.access_token) {
    throw new Error(`Login falló: ${signErr?.message ?? 'sin token'}. Ejecute npm run seed:superuser`);
  }
  const token = signIn.session.access_token;
  const userId = signIn.user!.id;

  console.log('3/6 platform_admins + listado courts (RLS cliente)…');
  const { data: adminRow, error: adminErr } = await client
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (adminErr) throw new Error(`platform_admins: ${adminErr.message}`);
  if (!adminRow?.user_id) {
    throw new Error('Usuario no está en platform_admins. Ejecute npm run seed:superuser');
  }

  const { data: courts, error: courtsErr } = await client
    .from('courts')
    .select('id, name, status')
    .order('name')
    .limit(5);
  if (courtsErr) throw new Error(`Listado courts: ${courtsErr.message}`);
  console.log(`   OK — ${courts?.length ?? 0} despacho(s) visibles (muestra)`);

  console.log('4/6 POST /api/platform/courts…');
  const createRes = await fetch(`${baseUrl}/api/platform/courts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: testCourtId,
      name: testCourtName,
      email: 'e2e@tutelia.local',
      city: 'Bogota',
      status: 'inactive',
    }),
  });
  const createJson = (await createRes.json()) as { courtId?: string; error?: string };
  if (!createRes.ok) {
    throw new Error(`Crear despacho: ${createJson.error ?? createRes.statusText}`);
  }
  if (createJson.courtId !== testCourtId) {
    throw new Error(`courtId inesperado: ${createJson.courtId}`);
  }
  console.log(`   OK — creado ${testCourtId}`);

  console.log('5/6 Auditoría platform_audit_log…');
  const { data: auditRows, error: auditErr } = await client
    .from('platform_audit_log')
    .select('action, target_court_id')
    .eq('target_court_id', testCourtId)
    .eq('action', 'court_created')
    .limit(1);
  if (auditErr) throw new Error(`Audit log: ${auditErr.message}`);
  if (!auditRows?.length) {
    throw new Error('No se encontró fila court_created en platform_audit_log');
  }
  console.log('   OK — auditoría registrada');

  console.log('6/6 Limpieza despacho de prueba…');
  await admin.from('platform_audit_log').delete().eq('target_court_id', testCourtId);
  const { error: delErr } = await admin.from('courts').delete().eq('id', testCourtId);
  if (delErr) console.warn('   Aviso limpieza:', delErr.message);
  else console.log('   OK — despacho E2E eliminado');

  await client.auth.signOut();
  console.log('\n✅ Verificación E2E plataforma completada.');
}

main().catch((e) => {
  console.error('\n❌', (e as Error).message);
  process.exit(1);
});
