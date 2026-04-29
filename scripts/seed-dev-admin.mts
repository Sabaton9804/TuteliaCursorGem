/**
 * Crea (o actualiza contraseña de) el usuario de desarrollo en Supabase Auth.
 *
 * SUPABASE_SERVICE_ROLE_KEY solo existe para que este script (Node, local) pueda
 * llamar a la API de administración; no es un «usuario en .env» ni escala con N usuarios.
 * Nunca la pongas en Vite ni en el bundle del navegador.
 *
 * Uso: npm run seed:dev-admin
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type User } from '@supabase/supabase-js';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD } from '../src/lib/dev-admin-auth.ts';

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
const email = DEV_ADMIN_EMAIL;
const password = DEV_ADMIN_PASSWORD;

if (!urlRaw?.trim() || !serviceKey?.trim()) {
  console.error(
    'Faltan VITE_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env — copie la service role del panel Supabase (Settings → API).'
  );
  process.exit(1);
}

const url = normalizeSupabaseUrl(urlRaw);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: 'Administrador', name: 'admin' },
});

if (!createErr && created.user) {
  console.log(`Usuario creado: ${email} (id ${created.user.id}). Perfil: trigger handle_new_user si la migración está aplicada.`);
  process.exit(0);
}

const msg = createErr?.message?.toLowerCase() ?? '';
if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
  const perPage = 200;
  let page: number | null = 1;
  let found: { id: string } | null = null;
  while (page != null && !found) {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage });
    if (listErr) {
      console.error('No se pudo listar usuarios:', listErr.message);
      process.exit(1);
    }
    const batch = list as { users: User[]; nextPage: number | null };
    found = batch.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
    page = batch.nextPage != null ? batch.nextPage : null;
  }
  if (!found) {
    console.error('El usuario parece existir pero no apareció en listUsers. Revise el email en el panel Auth.');
    process.exit(1);
  }
  const { error: updErr } = await admin.auth.admin.updateUserById(found.id, {
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Administrador', name: 'admin' },
  });
  if (updErr) {
    console.error('Error al actualizar contraseña:', updErr.message);
    process.exit(1);
  }
  console.log(`Usuario ya existía; contraseña actualizada para ${email}.`);
  process.exit(0);
}

console.error('Error al crear usuario:', createErr?.message ?? 'desconocido');
process.exit(1);
