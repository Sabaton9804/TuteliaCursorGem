/**
 * Cuentas «bot» por rol del despacho (pruebas, demos y automatización futura).
 * Complementa `seed-court-users.mts` (funcionarios reales del piloto).
 *
 * Requiere: VITE_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env
 *
 * Contraseña inicial: 123456 (o COURT_SEED_PASSWORD en .env).
 *
 * Uso: npm run seed:role-bots
 *
 * Idempotente: actualiza perfil y contraseña si el correo ya existe.
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

/** Un bot por rol operativo solicitado (+ sustanciador, pieza clave del flujo de fallo). */
const ROLE_BOTS: readonly { name: string; email: string; role: UserRole; descripcion: string }[] = [
  {
    name: 'Bot Juez',
    email: 'bot.juez@tutelia-despacho.seed',
    role: 'judge',
    descripcion: 'Aprueba borradores, firma autos/fallos, avanza etapas del despacho.',
  },
  {
    name: 'Bot Secretario',
    email: 'bot.secretario@tutelia-despacho.seed',
    role: 'clerk',
    descripcion: 'Radica tutelas, informe de ingreso, hitos de secretaría y coordinación.',
  },
  {
    name: 'Bot Escribiente',
    email: 'bot.escribiente@tutelia-despacho.seed',
    role: 'escribiente',
    descripcion: 'Oficios de notificación, carga documental y registro de envíos.',
  },
  {
    name: 'Bot Oficial Mayor',
    email: 'bot.oficial-mayor@tutelia-despacho.seed',
    role: 'official',
    descripcion: 'Remisión a Corte, logística expediente e incidentes administrativos.',
  },
  {
    name: 'Bot Asistente Judicial',
    email: 'bot.asistente@tutelia-despacho.seed',
    role: 'asistente_judicial',
    descripcion: 'Apoyo al juez en revisión de borradores y remisión a Corte.',
  },
  {
    name: 'Bot Sustanciador',
    email: 'bot.sustanciador@tutelia-despacho.seed',
    role: 'sustanciador',
    descripcion: 'Proyección de autos/fallos, revisión de expediente antes del fallo.',
  },
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

async function ensureBot(row: (typeof ROLE_BOTS)[number]): Promise<void> {
  const { name, email, role, descripcion } = row;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, name, is_role_bot: true, bot_descripcion: descripcion },
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
        user_metadata: { full_name: name, name, is_role_bot: true, bot_descripcion: descripcion },
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
  console.log(`  Perfil: ${name} (${role}) — ${descripcion}`);
}

console.log(`Sembrando ${ROLE_BOTS.length} bots de rol (${COURT_ID})…\n`);

for (const row of ROLE_BOTS) {
  console.log(row.name);
  await ensureBot(row);
  console.log('');
}

console.log(
  `Listo. Contraseña: ${password === DEFAULT_COURT_SEED_PASSWORD ? '123456' : '(definida en COURT_SEED_PASSWORD)'}.`
);
console.log('Correos: bot.*@tutelia-despacho.seed — metadata is_role_bot=true en Auth.');
