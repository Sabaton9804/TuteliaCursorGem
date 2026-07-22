import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const n of ['.env', '.env.local'] as const) {
  const f = path.join(root, n);
  if (fs.existsSync(f)) dotenv.config({ path: f });
}

const url = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) throw new Error('Faltan credenciales Supabase');

const admin = createClient(url, key, { auth: { persistSession: false } });
const target = '11001-31-03-051-2026-00385-00';

const { data: cases, error } = await admin
  .from('cases')
  .select('id, court_id, radicado, claimant, defendant, status, created_at, updated_at, sgde_id')
  .or(`radicado.eq.${target},radicado.like.%00385%`)
  .order('created_at', { ascending: true });

if (error) throw error;

console.log('Casos encontrados:', cases?.length ?? 0);
for (const c of cases ?? []) {
  const { count } = await admin
    .from('case_documents')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', c.id);
  console.log('---');
  console.log(JSON.stringify({ ...c, docCount: count }, null, 2));
  const { data: docs } = await admin
    .from('case_documents')
    .select('id, name, original_name, act_code, created_at, storage_path')
    .eq('case_id', c.id)
    .order('created_at', { ascending: true });
  for (const d of docs ?? []) {
    console.log(`  ${d.created_at} | ${d.act_code || '-'} | ${d.name || d.original_name}`);
  }
}
