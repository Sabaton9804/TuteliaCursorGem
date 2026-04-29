/**
 * Crea en Supabase Auth + public.profiles a los funcionarios del despacho (Juzgado court-1).
 *
 * Requiere: VITE_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env
 *
 * Contraseña inicial de los 7 usuarios del despacho: 123456 (solo desarrollo).
 * Opcional: COURT_SEED_PASSWORD en .env sustituye esa contraseña al ejecutar el script.
 *
 * Uso: npm run seed:court-users
 *
 * Idempotente: si el correo ya existe, actualiza contraseña, nombre en metadata y fila profiles.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type User } from '@supabase/supabase-js';
import type { UserRole } from '../src/types.ts';

const DEFAULT_COURT_SEED_PASSWORD = '123456';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function loadMergedEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(stripBom(fs.readFileSync(full, 'utf8')));
    for (const [key, raw] of Object.entries(parsed)) {
      const t = typeof raw === 'string' ? raw.trim() : String(raw).trim();
      if (t !== '') merged[key] = t;
    }
  }
  return merged;
}

function normalizeSupabaseUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s;
}

const COURT_ID = 'court-1';

const SEED_USERS: readonly { name: string; email: string; role: UserRole }[] = [
  { name: 'Gloria Patricia Montero Cabas', email: 'gloria.montero.cabas@tutelia-despacho.seed', role: 'judge' },
  { name: 'Camilo Andres Marroquín Hernandez', email: 'camilo.marroquin.hernandez@tutelia-despacho.seed', role: 'clerk' },
  { name: 'Diego Enrique Guarin Vega', email: 'diego.guarin.vega@tutelia-despacho.seed', role: 'sustanciador' },
  { name: 'Myriam Francesa Fonseca Alvarez', email: 'myriam.fonseca.alvarez@tutelia-despacho.seed', role: 'sustanciador' },
  { name: 'Yeiner Giovanny Osorio Florez', email: 'yeiner.osorio.florez@tutelia-despacho.seed', role: 'escribiente' },
  { name: 'Lina Paola Martinez Orjuela', email: 'lina.martinez.orjuela@tutelia-despacho.seed', role: 'escribiente' },
  { name: 'Edisson James Cantor Burgos', email: 'edisson.cantor.burgos@tutelia-despacho.seed', role: 'asistente_judicial' },
];

const env = loadMergedEnv();
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const password = (env.COURT_SEED_PASSWORD?.trim() || DEFAULT_COURT_SEED_PASSWORD).trim();

if (!urlRaw?.trim() || !serviceKey?.trim()) {
  console.error(
    'Faltan URL de Supabase y SUPABASE_SERVICE_ROLE_KEY en .env (Settings → API en el panel).'
  );
  process.exit(1);
}

const url = normalizeSupabaseUrl(urlRaw);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserIdByEmail(email: string): Promise<string | null> {
  const perPage = 200;
  let page: number | null = 1;
  const target = email.toLowerCase();
  while (page != null) {
    const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const batch = list as { users: User[]; nextPage: number | null };
    const hit = batch.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    page = batch.nextPage != null ? batch.nextPage : null;
  }
  return null;
}

async function ensureUser(row: (typeof SEED_USERS)[number]): Promise<void> {
  const { name, email, role } = row;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, name },
  });

  let userId: string | null = null;

  if (!createErr && created.user) {
    userId = created.user.id;
    console.log(`  Creado Auth: ${email} → ${userId}`);
  } else {
    const msg = createErr?.message?.toLowerCase() ?? '';
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      userId = await findUserIdByEmail(email);
      if (!userId) {
        console.error(`  No se encontró usuario existente para ${email}`);
        return;
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: name, name },
      });
      if (updErr) {
        console.error(`  Error actualizando ${email}:`, updErr.message);
        return;
      }
      console.log(`  Ya existía Auth: ${email} (perfil y contraseña actualizados)`);
    } else {
      console.error(`  Error creando ${email}:`, createErr?.message);
      return;
    }
  }

  const { error: pErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      name,
      role,
      court_id: COURT_ID,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (pErr) {
    console.error(`  Error profiles para ${email}:`, pErr.message);
    return;
  }
  console.log(`  Perfil: ${name} (${role})`);
}

console.log(`Sembrando ${SEED_USERS.length} usuarios del despacho (${COURT_ID})…\n`);

for (const row of SEED_USERS) {
  console.log(row.name);
  await ensureUser(row);
  console.log('');
}

console.log(
  `Listo. Contraseña: ${password === DEFAULT_COURT_SEED_PASSWORD ? '123456' : '(definida en COURT_SEED_PASSWORD)'}. Correos @tutelia-despacho.seed`
);
