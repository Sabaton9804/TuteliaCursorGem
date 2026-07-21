/**
 * Actualiza la plantilla informe_ingreso del despacho a marcadores duales (tutela/civil).
 * Uso: npx tsx scripts/update-informe-ingreso-civil-aware.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { CUERPO_INFORME_INGRESO_MARCADORES } from '../src/lib/plantilla-variables';
import { plainTextToTiptapDoc, docToStorage } from '../src/lib/tiptap-template-storage';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env: Record<string, string> = {};
for (const name of ['.env', '.env.local'] as const) {
  const full = path.join(root, name);
  if (fs.existsSync(full)) Object.assign(env, dotenv.parse(fs.readFileSync(full, 'utf8')));
}
const admin = createClient((env.VITE_SUPABASE_URL || '').replace(/\/+$/, ''), env.SUPABASE_SERVICE_ROLE_KEY || '', {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const storage = docToStorage(plainTextToTiptapDoc(CUERPO_INFORME_INGRESO_MARCADORES));
  const { data, error } = await admin
    .from('document_templates')
    .update({ contenido_base: storage, updated_at: new Date().toISOString() })
    .eq('tipo', 'informe_ingreso')
    .eq('court_id', 'court-1')
    .select('id, nombre');
  if (error) throw error;
  console.log('OK actualizado', data);
  console.log('Cuerpo:\n', CUERPO_INFORME_INGRESO_MARCADORES);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
