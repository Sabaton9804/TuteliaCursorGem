/**
 * Registra el buzón compartido M365 del despacho piloto (court-1) en court_mailboxes.
 *
 * Requiere: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env
 * Obligatorio: COURT_MAILBOX_UPN (UPN exacto en Entra, ej. juzgado051@ramajudicial.gov.co)
 *
 * Uso: COURT_MAILBOX_UPN="buzon@ramajudicial.gov.co" npm run seed:court-mailboxes
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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

const COURT_ID = process.env.COURT_ID?.trim() || 'court-1';

async function main() {
  const env = { ...loadMergedEnv(), ...process.env };
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const upn = (env.COURT_MAILBOX_UPN || env.PILOT_SHARED_MAILBOX_UPN || '').trim().toLowerCase();
  const displayName =
    (env.COURT_MAILBOX_DISPLAY_NAME || 'Buzón compartido del despacho').trim();

  if (!url || !key) {
    console.error('Falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  if (!upn) {
    console.error(
      'Defina COURT_MAILBOX_UPN con el UPN del buzón compartido en Microsoft 365 (Entra ID).'
    );
    process.exit(1);
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: court, error: courtErr } = await admin
    .from('courts')
    .select('id, name')
    .eq('id', COURT_ID)
    .maybeSingle();
  if (courtErr || !court) {
    console.error(`Despacho ${COURT_ID} no encontrado:`, courtErr?.message || 'sin fila');
    process.exit(1);
  }

  const { error } = await admin.from('court_mailboxes').upsert(
    {
      court_id: COURT_ID,
      mailbox_upn: upn,
      display_name: displayName,
      is_primary: true,
      is_active: true,
      mailbox_kind: 'shared',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'court_id,mailbox_upn' }
  );

  if (error) {
    console.error('Error al insertar court_mailboxes:', error.message);
    process.exit(1);
  }

  console.log(`OK: buzón ${upn} registrado para ${court.name} (${COURT_ID}).`);
  console.log('En /correo: conecte Outlook, elija este buzón y verifique permisos Mail.*.Shared en Entra.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
