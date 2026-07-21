/**
 * Repara expediente tutela 2ª 2026-1046: cuaderno Impugnación + rutas locales en piezas de radicación.
 * Uso: npx tsx scripts/repair-segunda-1046.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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
const CASE_ID = '9c64cc8b-9b67-42f0-9356-9cf62b1ef9c0';
const SGDE_PATH = 'Segunda instancia / Impugnación';
const NOTEBOOK = 'SI_IMPUGNACION';

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o anon key).');
  process.exit(1);
}

const admin = createClient(url, key);

async function main() {
  const { data: c, error: ce } = await admin
    .from('cases')
    .select('id, radicado, expediente_cuadernos_extra')
    .eq('id', CASE_ID)
    .maybeSingle();
  if (ce || !c?.id) throw new Error(ce?.message || 'Caso no encontrado');

  const extras = Array.isArray(c.expediente_cuadernos_extra) ? [...c.expediente_cuadernos_extra] : [];
  if (!extras.some((e: { code?: string }) => String(e.code || '').toUpperCase() === NOTEBOOK)) {
    extras.push({ code: NOTEBOOK, label: 'Impugnación' });
  }

  const { error: upCase } = await admin
    .from('cases')
    .update({ expediente_cuadernos_extra: extras, updated_at: new Date().toISOString() })
    .eq('id', CASE_ID);
  if (upCase) throw upCase;

  const { data: docs, error: de } = await admin
    .from('case_documents')
    .select('id, type, sgde_folder_path, notebook_code')
    .eq('case_id', CASE_ID)
    .neq('type', 'sgde_migrate');
  if (de) throw de;

  const localTypes = new Set(['email_body', 'attachment']);
  let patched = 0;
  for (const d of docs || []) {
    if (!localTypes.has(String(d.type))) continue;
    if (d.sgde_folder_path === SGDE_PATH && d.notebook_code === NOTEBOOK) continue;
    const { error } = await admin
      .from('case_documents')
      .update({ sgde_folder_path: SGDE_PATH, notebook_code: NOTEBOOK })
      .eq('id', d.id);
    if (error) throw error;
    patched += 1;
  }

  console.log(`Caso ${c.radicado}: cuaderno Impugnación en extras; ${patched} pieza(s) de radicación actualizadas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
