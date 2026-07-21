/**
 * Corrige en SGDE InformeIngresoDespacho.pdf.pdf → InformeIngresoDespacho.pdf
 * en los casos recientes (los tres que fallaron al abrir en el visor).
 *
 * Uso:
 *   npx tsx scripts/fix-informe-ingreso-double-pdf.mts --dry-run
 *   npx tsx scripts/fix-informe-ingreso-double-pdf.mts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  CASE_DOCUMENTS_BUCKET,
  ensureSinglePdfExtension,
} from '../server/case-document-storage';
import { SgdeClient, getDefaultSgdeBaseUrl, type SgdeTreeNode } from '../server/sgde-client';
import { decryptSgdePassword } from '../server/sgde-crypto';
import { tipoDocumentalSgdeFromFileName } from '../server/sgde-tutela-metadata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const TARGET_NAME = 'InformeIngresoDespacho.pdf';
const MAX_FIX = 3;

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

function isBrokenInformeName(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  if (!n.includes('informeingreso')) return false;
  return /\.pdf\.pdf$/i.test(n) || (n.match(/\.pdf/gi) || []).length >= 2;
}

function findPrincipalFolderId(root: SgdeTreeNode): string | null {
  const walk = (node: SgdeTreeNode): string | null => {
    const nm = String(node.name || '').toLowerCase();
    if (
      node.isFolder &&
      (nm.includes('principal') || /01cdo|c01_?principal|si_c01|pi_c01/.test(nm))
    ) {
      return node.id;
    }
    for (const ch of node.children || []) {
      const hit = walk(ch);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const urlRaw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!urlRaw || !serviceKey) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(urlRaw.replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: docs, error: docsErr } = await admin
    .from('case_documents')
    .select(
      'id, case_id, name, original_name, type, act_code, sgde_id, storage_path, created_at'
    )
    .or(
      'name.ilike.%InformeIngreso%,type.eq.informe_ingreso_expediente,act_code.eq.informe_ingreso'
    )
    .order('created_at', { ascending: false })
    .limit(40);
  if (docsErr) throw docsErr;

  const caseIds = [...new Set((docs || []).map((d) => String(d.case_id)))];
  const { data: cases, error: casesErr } = await admin
    .from('cases')
    .select('id, radicado, case_type, sgde_id, created_at')
    .in('id', caseIds.length ? caseIds : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: false });
  if (casesErr) throw casesErr;

  console.log(`Informes en BD: ${(docs || []).length} · casos: ${(cases || []).length}`);

  const { data: credRow, error: credErr } = await admin
    .from('sgde_credentials')
    .select('username, password_ciphertext')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (credErr) throw credErr;
  if (!credRow?.username || !credRow?.password_ciphertext) {
    throw new Error('Sin credenciales SGDE en BD');
  }

  const client = new SgdeClient(getDefaultSgdeBaseUrl());
  client.setCredentials(
    String(credRow.username).trim(),
    decryptSgdePassword(String(credRow.password_ciphertext))
  );
  const login = await client.login();
  if (login.ok === false) throw new Error(`Login SGDE: ${login.message}`);
  console.log('SGDE login OK', dryRun ? '(dry-run)' : '');

  let fixed = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const c of cases || []) {
    if (fixed >= MAX_FIX) break;

    const radicado = String(c.radicado || '').replace(/\D/g, '');
    if (radicado.length !== 23) {
      skipped += 1;
      continue;
    }

    let rootId = String(c.sgde_id || '').trim();
    if (!rootId) rootId = (await client.buscarExpedienteNodeId(radicado)) || '';
    if (!rootId) {
      skipped += 1;
      results.push({ radicado, status: 'skip', reason: 'sin expediente SGDE' });
      continue;
    }

    const { leaves } = await client.collectExpedienteForPreflight(rootId, {
      maxDepth: 12,
      maxNodes: 800,
      originRadicado: radicado,
    });
    const broken = leaves.filter((l) => isBrokenInformeName(l.name));
    console.log(`\n${radicado}: PDFs=${leaves.length} rotos=${broken.length}`);
    for (const b of broken) console.log(`  BROKEN ${b.name} (${b.id})`);

    if (!broken.length) {
      skipped += 1;
      results.push({ radicado, status: 'skip', reason: 'sin .pdf.pdf' });
      continue;
    }

    for (const leaf of broken) {
      if (fixed >= MAX_FIX) break;

      if (dryRun) {
        console.log(`  [dry-run] ${leaf.name} → ${TARGET_NAME}`);
        results.push({ radicado, status: 'dry_run', from: leaf.name, id: leaf.id });
        fixed += 1;
        continue;
      }

      const renamed = await client.renameDocumentNode(leaf.id, TARGET_NAME);
      if (renamed.ok) {
        console.log(`  OK rename → ${TARGET_NAME}`);
        const localDocs = (docs || []).filter((d) => String(d.case_id) === String(c.id));
        for (const d of localDocs) {
          const sameNode =
            d.sgde_id && String(d.sgde_id).toLowerCase() === leaf.id.toLowerCase();
          const isInforme = /informeingreso/i.test(String(d.name || ''));
          if (sameNode || isInforme) {
            await admin
              .from('case_documents')
              .update({ name: TARGET_NAME, original_name: TARGET_NAME })
              .eq('id', d.id);
          }
        }
        fixed += 1;
        results.push({ radicado, status: 'renamed', id: leaf.id });
        continue;
      }

      console.warn(`  rename falló: ${renamed.error}; delete+reupload`);

      const local =
        (docs || []).find(
          (d) =>
            String(d.case_id) === String(c.id) &&
            (String(d.sgde_id || '').toLowerCase() === leaf.id.toLowerCase() ||
              /informeingreso/i.test(String(d.name || '')))
        ) || null;

      if (!local?.storage_path) {
        failed += 1;
        results.push({
          radicado,
          status: 'fail',
          reason: `rename: ${renamed.error}; sin storage local`,
        });
        continue;
      }

      const { data: blob, error: dlErr } = await admin.storage
        .from(CASE_DOCUMENTS_BUCKET)
        .download(String(local.storage_path));
      if (dlErr || !blob) {
        failed += 1;
        results.push({ radicado, status: 'fail', reason: `download: ${dlErr?.message}` });
        continue;
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      if (buf.length < 100 || buf[0] !== 0x25 || buf[1] !== 0x50) {
        failed += 1;
        results.push({ radicado, status: 'fail', reason: 'PDF local inválido' });
        continue;
      }

      const del = await client.deleteDocumentNode(leaf.id);
      if (!del.ok) {
        failed += 1;
        results.push({ radicado, status: 'fail', reason: `delete: ${del.error}` });
        continue;
      }

      const tree = await client.buildTree(rootId, { maxDepth: 8, maxNodes: 400 });
      const principalId = findPrincipalFolderId(tree);
      if (!principalId) {
        failed += 1;
        results.push({ radicado, status: 'fail', reason: 'sin carpeta Principal' });
        continue;
      }

      const fileName = ensureSinglePdfExtension(TARGET_NAME);
      const orden = leaf.orden && /^\d+$/.test(leaf.orden) ? parseInt(leaf.orden, 10) : undefined;
      const up = await client.uploadDocumentToFolder({
        folderNodeUuid: principalId,
        radicado23: radicado,
        buffer: buf,
        fileName,
        contentType: 'application/pdf',
        tipoDocumental: tipoDocumentalSgdeFromFileName(fileName, local.type, local.act_code),
        expedienteMetadata: {},
        orden,
      });
      if (up.ok === false) {
        failed += 1;
        results.push({ radicado, status: 'fail', reason: `reupload: ${up.error}` });
        continue;
      }

      await admin
        .from('case_documents')
        .update({
          name: fileName,
          original_name: fileName,
          ...(up.sgdeDocId
            ? { sgde_id: up.sgdeDocId, sgde_sync_status: 'linked' }
            : {}),
        })
        .eq('id', local.id);

      console.log(`  OK reupload → ${fileName} (${up.sgdeDocId || 'sin id'})`);
      fixed += 1;
      results.push({ radicado, status: 'reuploaded', id: up.sgdeDocId });
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(JSON.stringify({ dryRun, fixed, skipped, failed, results }, null, 2));
  if (!dryRun && fixed < 1) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
