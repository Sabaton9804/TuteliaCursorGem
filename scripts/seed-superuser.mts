/**
 * Crea o actualiza el superusuario de plataforma (todos los despachos).
 *
 * Requiere: VITE_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env
 * Antes: aplicar supabase/migrations/20260526120000_profiles_superuser.sql
 *        y 20260613120000_platform_admins.sql en SQL Editor.
 *
 * Uso: npm run seed:superuser
 * Login en Tutelia: Sabaton98 / 123456 (o variables SUPERUSER_LOGIN / SUPERUSER_PASSWORD)
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type User } from '@supabase/supabase-js';
import { SUPERUSER_EMAIL } from '../src/lib/superuser-auth.ts';

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

const env = loadMergedEnv();
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const email = (env.SUPERUSER_EMAIL || SUPERUSER_EMAIL).trim().toLowerCase();
const password = (env.SUPERUSER_PASSWORD || '123456').trim();
const displayName = (env.SUPERUSER_NAME || 'Sabaton98 (superusuario)').trim();
const courtId = (env.SUPERUSER_COURT_ID || 'court-1').trim();

if (!urlRaw?.trim() || !serviceKey?.trim()) {
  console.error('Faltan URL de Supabase y SUPABASE_SERVICE_ROLE_KEY en .env.');
  process.exit(1);
}

const url = normalizeSupabaseUrl(urlRaw);
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserIdByEmail(targetEmail: string): Promise<string | null> {
  const perPage = 200;
  let page: number | null = 1;
  const target = targetEmail.toLowerCase();
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

let userId: string | null = null;

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: displayName, name: 'Sabaton98' },
});

if (!createErr && created.user) {
  userId = created.user.id;
  console.log(`Usuario Auth creado: ${email}`);
} else {
  const msg = createErr?.message?.toLowerCase() ?? '';
  if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
    userId = await findUserIdByEmail(email);
    if (!userId) {
      console.error('Usuario existente pero no encontrado en listUsers.');
      process.exit(1);
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName, name: 'Sabaton98' },
    });
    if (updErr) {
      console.error('Error al actualizar contraseña:', updErr.message);
      process.exit(1);
    }
    console.log(`Usuario Auth actualizado: ${email}`);
  } else {
    console.error('Error al crear usuario:', createErr?.message);
    process.exit(1);
  }
}

const { error: profileErr } = await admin.from('profiles').upsert(
  {
    id: userId,
    email,
    name: displayName,
    role: 'admin',
    court_id: courtId,
    is_superuser: true,
    updated_at: new Date().toISOString(),
  },
  { onConflict: 'id' }
);

if (profileErr) {
  if (/is_superuser|schema cache/i.test(profileErr.message)) {
    console.error(
      'Falta la columna is_superuser. En Supabase → SQL Editor ejecute:\n' +
        '  supabase/migrations/20260526120000_profiles_superuser.sql'
    );
  } else {
    console.error('Error en profiles:', profileErr.message);
  }
  process.exit(1);
}

const { error: platformAdminErr } = await admin.from('platform_admins').upsert(
  {
    user_id: userId,
    notes: 'Seed npm run seed:superuser',
  },
  { onConflict: 'user_id' }
);

if (platformAdminErr) {
  if (/platform_admins|schema cache/i.test(platformAdminErr.message)) {
    console.warn(
      'Aviso: falta platform_admins. Ejecute supabase/migrations/20260613120000_platform_admins.sql'
    );
  } else {
    console.warn('Aviso platform_admins:', platformAdminErr.message);
  }
}

console.log('');
console.log('Superusuario listo.');
console.log(`  Login Tutelia: Sabaton98`);
console.log(`  Contraseña:    ${password}`);
console.log(`  Email Auth:    ${email}`);
console.log(`  Rol:           admin + platform admin (todos los despachos)`);
console.log(`  Despacho base: ${courtId}`);
