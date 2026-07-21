/**
 * Reemplaza CorreoReparto.pdf en tutela 2ª 2026-1382 (CUI 11001418909020260138200).
 *
 * Uso: npx tsx scripts/replace-correo-reparto-1382.mts "C:\path\Correo....pdf"
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
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const RADICADO = '11001418909020260138201';
const DEFAULT_SRC =
  'C:\\Users\\USUARIO\\Downloads\\Correo_ Juzgado 51 Civil Circuito - Bogotá - Bogotá D.C. - Outlook.pdf';
const BUCKET = 'case-documents';
const LOGICAL_NAME = 'CorreoReparto.pdf';

async function main() {
  const srcPdf = process.argv[2] || DEFAULT_SRC;
  if (!fs.existsSync(srcPdf)) {
    throw new Error(`No existe el PDF: ${srcPdf}`);
  }

  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('id, radicado')
    .eq('radicado', RADICADO)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow?.id) throw new Error(`Caso no encontrado: ${RADICADO}`);

  const caseId = String(caseRow.id);
  console.log('Caso:', caseId, caseRow.radicado);

  const { data: docs, error: docErr } = await admin
    .from('case_documents')
    .select('id, name, type, storage_path, act_code, notebook_code, sort_order')
    .eq('case_id', caseId)
    .order('sort_order', { ascending: true });
  if (docErr) throw docErr;

  const target =
    (docs || []).find(
      (d) =>
        String(d.name || '').toLowerCase().replace(/\.pdf$/i, '') === 'correoreparto' ||
        d.type === 'email_body' ||
        d.act_code === 'correo_reparto'
    ) ?? null;
  if (!target?.id) {
    console.log(
      'Documentos:',
      (docs || []).map((d) => `${d.name} (${d.type})`).join(', ')
    );
    throw new Error('No se encontró CorreoReparto en case_documents');
  }

  console.log('Pieza a reemplazar:', target.id, target.name, target.storage_path || '(sin storage)');

  const bytes = fs.readFileSync(srcPdf);
  const objectPath = `cases/${caseId}/${crypto.randomUUID()}_${LOGICAL_NAME}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (upErr) throw upErr;

  const oldPath = target.storage_path ? String(target.storage_path) : null;

  const { error: updErr } = await admin
    .from('case_documents')
    .update({
      name: 'CorreoReparto',
      original_name: path.basename(srcPdf),
      type: 'expediente_acto',
      act_code: 'correo_reparto',
      content_type: 'application/pdf',
      size: bytes.length,
      storage_path: objectPath,
      sgde_folder_path: 'Segunda instancia / Impugnación',
      notebook_code: 'SI_C01_PRINCIPAL',
      error: null,
      content: null,
      is_from_link: false,
    })
    .eq('id', target.id)
    .eq('case_id', caseId);
  if (updErr) throw updErr;

  if (oldPath && oldPath !== objectPath) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove([oldPath]);
    if (rmErr) console.warn('No se pudo borrar objeto anterior:', rmErr.message);
    else console.log('Objeto anterior eliminado:', oldPath);
  }

  console.log('OK — CorreoReparto reemplazado:', objectPath, `(${bytes.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
