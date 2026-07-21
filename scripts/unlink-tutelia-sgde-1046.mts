/**
 * Quita todo vínculo SGDE del caso 1046 en Tutelia (sin borrar el caso ni los PDF locales).
 * Uso: npx tsx scripts/unlink-tutelia-sgde-1046.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const CASE_ID = '9c64cc8b-9b67-42f0-9356-9cf62b1ef9c0';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const n of ['.env', '.env.local'] as const) {
  const f = path.join(root, n);
  if (fs.existsSync(f)) dotenv.config({ path: f });
}

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) throw new Error('Faltan credenciales Supabase');

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: before } = await admin.from('cases').select('radicado, sgde_id').eq('id', CASE_ID).single();
console.log('Antes:', before);

const { data: docs, error: docsErr } = await admin.from('case_documents').select('id, name').eq('case_id', CASE_ID);
if (docsErr) throw docsErr;

for (const d of docs || []) {
  const { error } = await admin
    .from('case_documents')
    .update({
      sgde_id: null,
      sgde_sync_status: 'none',
    })
    .eq('id', d.id);
  if (error) throw error;
}

await admin.from('case_sgde_folder_map').delete().eq('case_id', CASE_ID);

const { data: after, error: caseErr } = await admin
  .from('cases')
  .update({ sgde_id: null, sgde_sync_status: 'idle', updated_at: new Date().toISOString() })
  .eq('id', CASE_ID)
  .select('radicado, sgde_id, sgde_sync_status')
  .single();
if (caseErr) throw caseErr;

console.log('Después:', after);
console.log(`Piezas desvinculadas: ${docs?.length ?? 0}`);
console.log('El caso sigue en Tutelia con PDF locales; ya no aparece «Vinculado a SGDE».');
