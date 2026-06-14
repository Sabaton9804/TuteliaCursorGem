/**
 * Asigna operador regional de prueba (consola /plataforma por territorio).
 *
 * NO usar funcionarios de despacho (Paola, etc.): ellos solo operan UN court_id.
 * Este seed crea/asigna una cuenta de COORDINACIÓN REGIONAL (Rama), distinta del staff.
 *
 * Requiere migración 20260614150000_platform_regional_admins.sql
 *
 * Uso: npm run seed:regional-admin
 * Login: Regional.Bogota / 123456
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type User } from '@supabase/supabase-js';

export const REGIONAL_ADMIN_EMAIL = 'regional.bogota@tutelia.local';
export const REGIONAL_ADMIN_LOGIN = 'Regional.Bogota';

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

async function findUserIdByEmail(admin: ReturnType<typeof createClient>, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  let page: number | null = 1;
  const perPage = 200;
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

const env = loadMergedEnv();
const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const email = (env.REGIONAL_ADMIN_EMAIL || REGIONAL_ADMIN_EMAIL).trim().toLowerCase();
const password = (env.REGIONAL_ADMIN_PASSWORD || '123456').trim();
const displayName = (env.REGIONAL_ADMIN_NAME || 'Coordinador regional Bogotá (demo)').trim();
const territoryDane = (env.REGIONAL_ADMIN_TERRITORY_DANE || '11001').trim();
const notes = (env.REGIONAL_ADMIN_NOTES || 'Seed npm run seed:regional-admin — no es staff de despacho').trim();
const courtId = (env.REGIONAL_ADMIN_COURT_ID || 'court-1').trim();

if (!urlRaw || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const admin = createClient(normalizeSupabaseUrl(urlRaw), serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { error: tableErr } = await admin.from('platform_regional_admins').select('user_id').limit(1);
if (tableErr) {
  if (/platform_regional_admins|schema cache/i.test(tableErr.message)) {
    console.error(
      'Falta la migración F. Ejecute: supabase/migrations/20260614150000_platform_regional_admins.sql'
    );
  } else {
    console.error('Error comprobando platform_regional_admins:', tableErr.message);
  }
  process.exit(1);
}

let userId = await findUserIdByEmail(admin, email);

if (!userId) {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName, name: displayName.split(' ')[0] },
  });
  if (createErr || !created.user?.id) {
    console.error('No se pudo crear usuario regional:', createErr?.message);
    process.exit(1);
  }
  userId = created.user.id;
}

await admin.from('profiles').upsert(
  {
    id: userId,
    email,
    name: displayName,
    role: 'admin',
    court_id: courtId,
    is_superuser: false,
    updated_at: new Date().toISOString(),
  },
  { onConflict: 'id' }
);

const { data: platformAdmin } = await admin
  .from('platform_admins')
  .select('user_id')
  .eq('user_id', userId)
  .maybeSingle();

if (platformAdmin?.user_id) {
  console.warn('Aviso: este usuario también está en platform_admins (acceso nacional).');
}

const { data: territory, error: terrErr } = await admin
  .from('judicial_territories')
  .select('id, name, department')
  .eq('dane_code', territoryDane)
  .maybeSingle();

if (terrErr || !territory?.id) {
  console.error(`Territorio DANE ${territoryDane} no encontrado.`);
  process.exit(1);
}

const { error: insErr } = await admin.from('platform_regional_admins').upsert(
  {
    user_id: userId,
    territory_id: territory.id,
    notes,
  },
  { onConflict: 'user_id,territory_id' }
);

if (insErr) {
  console.error('Error al asignar regional admin:', insErr.message);
  process.exit(1);
}

console.log('Operador regional (NO staff de juzgado) listo.');
console.log(`  Login formulario: ${REGIONAL_ADMIN_LOGIN} / ${password}`);
console.log(`  Email Auth:       ${email}`);
console.log(`  Territorio:       ${territory.name} — ve todos los despachos de Bogotá en /plataforma`);
console.log('  Operación diaria: debe usar Operar como… para UN despacho a la vez');
console.log('');
console.log('  Admin nacional (TI, todo el país): Sabaton98 → platform_admins');
