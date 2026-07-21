/**
 * Elimina del expediente SGDE 376 (tutela ajena) los 4 PDFs públicos
 * subidos por error desde Tutelia (EscritoDemanda, AnexosDemanda, ActaReparto, CorreoReparto).
 *
 * Uso: npx tsx scripts/cleanup-sgde-wrong-uploads-376.mts
 *       npx tsx scripts/cleanup-sgde-wrong-uploads-376.mts --dry-run
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';

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
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const dryRun = process.argv.includes('--dry-run');
const EXPEDIENTE_SGDE_ID = 'eae6faca-24bf-4212-a363-85e8e0daeab9';
const RADICADO_376 = '11001310305120260037600';

/** Nombres lógicos que Tutelia subió al 376 por error (sin extensión). */
const WRONG_BASES = new Set(['escritodemanda', 'anexosdemanda', 'actareparto', 'correoreparto']);

function baseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function isWrongUpload(name: string): boolean {
  const b = baseName(name);
  if (WRONG_BASES.has(b)) return true;
  // Variantes con sufijo numérico tipo EscritoDemanda01
  for (const w of WRONG_BASES) {
    if (b === w || (b.startsWith(w) && /^[0-9]+$/.test(b.slice(w.length)))) return true;
  }
  return false;
}

async function main() {
  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: credRow, error: credErr } = await admin
    .from('sgde_credentials')
    .select('username, password_ciphertext')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (credErr) throw credErr;
  if (!credRow?.username || !credRow?.password_ciphertext) {
    throw new Error('Sin credenciales SGDE en BD. Configure en Ajustes → Interconexión SGDE.');
  }

  const client = new SgdeClient(getDefaultSgdeBaseUrl());
  client.setCredentials(
    String(credRow.username).trim(),
    decryptSgdePassword(String(credRow.password_ciphertext)),
  );
  const login = await client.login();
  if (login.ok === false) throw new Error(`Login SGDE: ${login.message}`);

  let rootId = EXPEDIENTE_SGDE_ID;
  const found = await client.buscarExpedienteNodeId(RADICADO_376);
  if (found) {
    rootId = found;
    console.log('Expediente SGDE resuelto por CUI:', rootId);
  } else {
    console.log('Usando sgde_id conocido:', rootId);
  }

  const leaves = await client.fetchPdfLeavesViaSearch(rootId, { maxDocs: 200 });
  console.log(`Documentos en SGDE: ${leaves.length}`);
  for (const L of leaves) {
    console.log(`  - ${L.name} | orden=${L.orden ?? '?'} | tipo=${L.tipoDocumental ?? '?'}`);
  }

  const targets = leaves.filter((L) => isWrongUpload(L.name));
  console.log(`\nA eliminar (subidas erróneas Tutelia): ${targets.length}`);
  for (const t of targets) {
    console.log(`  → ${t.name} (${t.id})`);
  }

  if (!targets.length) {
    console.log('Nada que borrar (ya limpio o nombres distintos).');
    return;
  }

  if (dryRun) {
    console.log('\n[dry-run] No se eliminó nada.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    const res = await client.deleteDocumentNode(t.id);
    if (res.ok) {
      ok += 1;
      console.log(`OK eliminado: ${t.name}`);
    } else {
      fail += 1;
      console.error(`FAIL ${t.name}: ${res.error}`);
    }
  }
  console.log(`\nListo: ${ok} eliminados, ${fail} fallos.`);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
