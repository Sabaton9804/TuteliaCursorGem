/**
 * Elimina piezas duplicadas en tutela 2ª: filas sgde_migrate cuyo sgde_id
 * ya está enlazado a una pieza local (email_body / attachment).
 *
 * Uso:
 *   npx tsx scripts/cleanup-duplicate-sgde-docs.mts f0369192-f0b3-4304-af3f-0d614caeca05 --dry-run
 *   npx tsx scripts/cleanup-duplicate-sgde-docs.mts f0369192-f0b3-4304-af3f-0d614caeca05
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  CASE_DOCUMENTS_BUCKET,
  removeCaseDocumentObjectsAdmin,
} from '../server/case-document-storage.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const caseId = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));

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

async function main() {
  if (!caseId) {
    throw new Error('Indique caseId UUID: npx tsx scripts/cleanup-duplicate-sgde-docs.mts <caseId>');
  }

  const env = loadEnv();
  const urlRaw =
    env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(urlRaw.replace(/\/+$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: docs, error } = await admin
    .from('case_documents')
    .select('id, name, type, sgde_id, storage_path, notebook_code')
    .eq('case_id', caseId);
  if (error) throw error;

  const bySgdeId = new Map<string, typeof docs>();
  for (const d of docs || []) {
    const sid = String(d.sgde_id || '').trim().toLowerCase();
    if (!sid) continue;
    const list = bySgdeId.get(sid) || [];
    list.push(d);
    bySgdeId.set(sid, list);
  }

  const toDelete: typeof docs = [];
  for (const [, group] of bySgdeId) {
    if (group.length < 2) continue;
    const keep =
      group.find((d) => d.type === 'email_body' || d.type === 'attachment') || group[0];
    for (const d of group) {
      if (d.id !== keep.id) toDelete.push(d);
    }
  }

  console.log(`Duplicados por sgde_id: ${toDelete.length}`);
  for (const d of toDelete) {
    console.log(`  → ${d.name} (${d.type}) sgde=${String(d.sgde_id).slice(0, 8)}…`);
  }

  if (!toDelete.length) {
    console.log('Nada que borrar.');
    return;
  }

  if (dryRun) {
    console.log('[dry-run] No se eliminó nada.');
    return;
  }

  const paths = toDelete.map((d) => String(d.storage_path || '').trim()).filter(Boolean);
  if (paths.length) {
    await removeCaseDocumentObjectsAdmin(admin, paths);
  }

  for (const d of toDelete) {
    const { error: delErr } = await admin.from('case_documents').delete().eq('id', d.id);
    if (delErr) throw delErr;
    console.log(`OK borrado: ${d.name}`);
  }

  console.log(`Listo: ${toDelete.length} fila(s) duplicada(s) eliminada(s).`);
  console.log(`(Storage bucket: ${CASE_DOCUMENTS_BUCKET})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
