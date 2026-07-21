import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient, SgdePdfLeaf } from './sgde-client';
import {
  CASE_DOCUMENTS_BUCKET,
  sanitizeCaseDocumentLogicalName,
  uploadCaseAttachmentAdmin,
  removeCaseDocumentObjectsAdmin,
  insertCaseDocumentRowsAdmin,
  nextSortOrderForCase,
} from './case-document-storage';
import { sgdeFilenameToProtocolName, notebookCodeFromSgdeFolderPath } from './sgde-migrate';

type DocRow = {
  id: string;
  name: string;
  type: string;
  storage_path: string | null;
  content_type: string | null;
  notebook_code: string | null;
  sgde_id: string | null;
  sgde_folder_path: string | null;
};

export type RepairStorageFromSgdeResult = {
  ok: boolean;
  repaired: number;
  imported: number;
  failed: number;
  skipped: number;
  errors: string[];
  message: string;
};

async function storageObjectReadable(
  admin: SupabaseClient,
  path: string
): Promise<boolean> {
  const p = path.trim();
  if (!p) return false;
  const { data, error } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).download(p);
  if (error || !data) return false;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf.length >= 100;
}

function notebookForCaseType(caseType: string | null): string {
  return caseType === 'tutela_segunda' ? 'SI_C01_PRINCIPAL' : 'PI_C01_PRINCIPAL';
}

function notebookFromFolderPath(folderPath: string | undefined, fallback: string): string {
  return notebookCodeFromSgdeFolderPath(folderPath, fallback);
}

/** Tutelia manda: no pisar cuaderno ya asignado (p. ej. C02) solo porque el PDF quedó en Principal por un sync viejo. */
function resolveNotebookForRepair(
  existing: string | null | undefined,
  folderPath: string | undefined,
  fallback: string
): string {
  const cur = String(existing || '').trim();
  if (cur && (/^PI_/i.test(cur) || /^SI_/i.test(cur))) {
    if (/^PI_PRINCIPAL$/i.test(cur)) return 'PI_C01_PRINCIPAL';
    if (/^SI_PRINCIPAL$/i.test(cur)) return 'SI_C01_PRINCIPAL';
    return cur;
  }
  return notebookFromFolderPath(folderPath, fallback);
}

async function repairOneDoc(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  doc: DocRow;
  sgdeId: string;
  leafName?: string;
}): Promise<{ ok: true; path: string; size: number } | { ok: false; error: string }> {
  const { client, admin, caseId, doc, sgdeId } = opts;
  const downloaded = await client.downloadNodeContent(sgdeId);
  if (!downloaded?.buffer?.length) {
    return { ok: false as const, error: 'Sin contenido PDF en SGDE' };
  }
  const baseName = opts.leafName || doc.name || 'DocumentoSgde';
  const logicalName = sanitizeCaseDocumentLogicalName(
    sgdeFilenameToProtocolName(baseName),
    `${doc.name || 'documento'}.pdf`
  );
  const up = await uploadCaseAttachmentAdmin(
    admin,
    caseId,
    logicalName,
    downloaded.buffer,
    'application/pdf'
  );
  if ('error' in up) return { ok: false as const, error: up.error.message };

  const oldPath = doc.storage_path?.trim();
  if (oldPath && oldPath !== up.path) {
    await removeCaseDocumentObjectsAdmin(admin, [oldPath]);
  }

  const { error: updErr } = await admin
    .from('case_documents')
    .update({
      storage_path: up.path,
      size: downloaded.buffer.length,
      content_type: 'application/pdf',
      sgde_id: sgdeId,
      sgde_sync_status: 'linked',
    })
    .eq('id', doc.id);
  if (updErr) return { ok: false as const, error: updErr.message };

  return { ok: true as const, path: up.path, size: downloaded.buffer.length };
}

export type CaseDocumentViewUrlResult =
  | { ok: true; signedUrl: string; storagePath: string; repaired: boolean }
  | { ok: false; error: string };

/** Resuelve el nodo SGDE de una pieza (por sgde_id o emparejamiento por nombre en el árbol). */
export async function resolveSgdeNodeIdForDocument(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  doc: Pick<DocRow, 'sgde_id' | 'name'>;
}): Promise<string | null> {
  let sgdeId = String(opts.doc.sgde_id || '').trim();
  if (sgdeId) return sgdeId;

  const { data: caseRow } = await opts.admin
    .from('cases')
    .select('sgde_id, radicado')
    .eq('id', opts.caseId)
    .maybeSingle();
  const sgdeRootId = String(caseRow?.sgde_id || '').trim();
  const radicado23 = String(caseRow?.radicado || '').replace(/\D/g, '').slice(0, 23);
  if (!sgdeRootId || radicado23.length !== 23) return null;

  const leaves = await opts.client.collectPdfLeavesForExpediente(sgdeRootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado: radicado23,
  });
  for (const leaf of leaves) {
    const m = matchLeafToDoc(leaf, [{ ...opts.doc, id: '', type: '', storage_path: null, content_type: null, notebook_code: null, sgde_folder_path: null }], new Set());
    if (m) return leaf.id;
  }
  return null;
}

/** Lee el PDF en memoria desde SGDE (sin pasar por Storage). */
export async function downloadCaseDocumentFromSgde(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  doc: Pick<DocRow, 'sgde_id' | 'name'>;
}): Promise<Buffer | null> {
  const sgdeId = await resolveSgdeNodeIdForDocument(opts);
  if (!sgdeId) return null;
  const downloaded = await opts.client.downloadNodeContent(sgdeId);
  if (!downloaded?.buffer?.length) return null;
  return downloaded.buffer;
}

/** Garantiza el PDF en Storage (re-descarga desde SGDE si falta) y devuelve URL firmada. */
export async function ensureCaseDocumentViewUrl(opts: {
  admin: SupabaseClient;
  client: SgdeClient | null;
  caseId: string;
  documentId: string;
  ttlSec?: number;
}): Promise<CaseDocumentViewUrlResult> {
  const { admin, caseId, documentId } = opts;
  const ttlSec = opts.ttlSec ?? 30 * 60;

  const { data: docRaw, error: docErr } = await admin
    .from('case_documents')
    .select('id, name, type, storage_path, content_type, notebook_code, sgde_id, sgde_folder_path')
    .eq('id', documentId)
    .eq('case_id', caseId)
    .maybeSingle();
  if (docErr || !docRaw?.id) {
    return { ok: false, error: 'Documento no encontrado en el expediente.' };
  }
  const doc = docRaw as DocRow;
  let storagePath = String(doc.storage_path || '').trim();
  let repaired = false;

  const signPath = async (path: string) => {
    const { data, error } = await admin.storage
      .from(CASE_DOCUMENTS_BUCKET)
      .createSignedUrl(path, ttlSec);
    if (error || !data?.signedUrl) {
      return { ok: false as const, error: error?.message || 'No se pudo firmar la URL del PDF.' };
    }
    return { ok: true as const, signedUrl: data.signedUrl };
  };

  if (storagePath && (await storageObjectReadable(admin, storagePath))) {
    const signed = await signPath(storagePath);
    if (signed.ok) return { ok: true, signedUrl: signed.signedUrl, storagePath, repaired: false };
    storagePath = '';
  }

  const client = opts.client;
  if (!client) {
    return {
      ok: false,
      error:
        'El archivo no está en Storage. Configure credenciales SGDE en Ajustes y pulse Reparar PDF.',
    };
  }

  const sgdeId = client
    ? await resolveSgdeNodeIdForDocument({ client, admin, caseId, doc })
    : String(doc.sgde_id || '').trim() || null;

  if (!sgdeId) {
    return {
      ok: false,
      error: 'El PDF no está en Storage y no hay vínculo SGDE para re-descargarlo.',
    };
  }

  const fix = await repairOneDoc({
    client,
    admin,
    caseId,
    doc,
    sgdeId,
    leafName: doc.name,
  });
  if ('error' in fix) {
    return { ok: false, error: fix.error };
  }
  storagePath = fix.path;
  repaired = true;

  const signed = await signPath(storagePath);
  if (!signed.ok) return { ok: false, error: signed.error };
  return { ok: true, signedUrl: signed.signedUrl, storagePath, repaired };
}

async function importLeaf(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  leaf: SgdePdfLeaf;
  notebookCode: string;
  sortOrder: number;
  existingNames: Set<string>;
}): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  const { client, admin, caseId, leaf, notebookCode, existingNames } = opts;
  const downloaded = await client.downloadNodeContent(leaf.id);
  if (!downloaded?.buffer?.length) {
    return { ok: false as const, error: 'Sin contenido PDF en SGDE' };
  }
  const logicalBase = sgdeFilenameToProtocolName(leaf.name, leaf.orden);
  let logicalName = logicalBase;
  let suffix = 1;
  while (existingNames.has(logicalName)) {
    const stem = logicalBase.replace(/\.pdf$/i, '');
    logicalName = sanitizeCaseDocumentLogicalName(`${stem}${suffix}.pdf`, logicalBase);
    suffix += 1;
  }
  existingNames.add(logicalName);

  const up = await uploadCaseAttachmentAdmin(
    admin,
    caseId,
    logicalName,
    downloaded.buffer,
    'application/pdf'
  );
  if ('error' in up) return { ok: false as const, error: up.error.message };

  const nb = notebookFromFolderPath(leaf.folderPath, notebookCode);
  const ins = await insertCaseDocumentRowsAdmin(admin, [
    {
      case_id: caseId,
      name: logicalName.replace(/\.pdf$/i, ''),
      original_name: leaf.name,
      type: 'sgde_migrate',
      content_type: 'application/pdf',
      size: downloaded.buffer.length,
      storage_path: up.path,
      is_from_link: false,
      sort_order: opts.sortOrder,
      notebook_code: nb,
      sgde_id: leaf.id,
      sgde_folder_path: leaf.folderPath || null,
      sgde_sync_status: 'linked',
    },
  ]);
  if (ins.error) return { ok: false as const, error: ins.error.message };
  const inserted = (ins.data as { id: string }[] | null)?.[0];
  if (!inserted?.id) return { ok: false as const, error: 'Insert sin id' };
  return { ok: true as const, docId: String(inserted.id) };
}

function normalizeDocKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function matchLeafToDoc(
  leaf: SgdePdfLeaf,
  docs: DocRow[],
  usedDocIds: Set<string>
): DocRow | null {
  const leafId = leaf.id.toLowerCase();
  for (const d of docs) {
    if (usedDocIds.has(d.id)) continue;
    if (d.sgde_id?.trim().toLowerCase() === leafId) return d;
  }
  const leafKey = normalizeDocKey(leaf.name);
  if (!leafKey) return null;
  for (const d of docs) {
    if (usedDocIds.has(d.id)) continue;
    const docKey = normalizeDocKey(d.name);
    if (docKey && (docKey === leafKey || leafKey.includes(docKey) || docKey.includes(leafKey))) {
      return d;
    }
  }
  return null;
}

/** Descarga PDF faltantes desde SGDE hacia Storage y actualiza filas existentes; importa hojas solo-SGDE. */
export async function repairStorageFromSgde(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  sgdeRootId: string;
  caseType: string | null;
  originRadicado: string;
  importSgdeOnly?: boolean;
}): Promise<RepairStorageFromSgdeResult> {
  const { client, admin, caseId, sgdeRootId } = opts;
  const importSgdeOnly = opts.importSgdeOnly !== false;
  const notebookCode = notebookForCaseType(opts.caseType);
  const errors: string[] = [];
  let repaired = 0;
  let imported = 0;
  let failed = 0;
  let skipped = 0;

  const sgdeLeaves = await client.collectPdfLeavesForExpediente(sgdeRootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado: opts.originRadicado,
  });

  const { data: docsRaw } = await admin
    .from('case_documents')
    .select(
      'id, name, type, storage_path, content_type, notebook_code, sgde_id, sgde_folder_path'
    )
    .eq('case_id', caseId)
    .order('sort_order', { ascending: true });

  const docs = (docsRaw || []) as DocRow[];
  const usedDocIds = new Set<string>();
  const usedLeafIds = new Set<string>();

  for (const leaf of sgdeLeaves) {
    const matched = matchLeafToDoc(leaf, docs, usedDocIds);
    if (!matched) continue;
    usedDocIds.add(matched.id);
    usedLeafIds.add(leaf.id);

    const path = matched.storage_path?.trim();
    const hasContent = path ? await storageObjectReadable(admin, path) : false;
    if (hasContent) {
      skipped += 1;
      if (leaf.folderPath) {
        await admin
          .from('case_documents')
          .update({
            sgde_id: leaf.id,
            sgde_folder_path: leaf.folderPath,
            notebook_code: resolveNotebookForRepair(
              matched.notebook_code,
              leaf.folderPath,
              notebookCode
            ),
            sgde_sync_status: 'linked',
          })
          .eq('id', matched.id);
      }
      continue;
    }

    const sgdeId = matched.sgde_id?.trim() || leaf.id;
    const res = await repairOneDoc({
      client,
      admin,
      caseId,
      doc: matched,
      sgdeId,
      leafName: leaf.name,
    });
    if ('error' in res) {
      failed += 1;
      errors.push(`${matched.name}: ${res.error}`);
    } else {
      repaired += 1;
      await admin
        .from('case_documents')
        .update({
          sgde_folder_path: leaf.folderPath || matched.sgde_folder_path,
          notebook_code: resolveNotebookForRepair(
            matched.notebook_code,
            leaf.folderPath,
            notebookCode
          ),
          original_name: leaf.name,
        })
        .eq('id', matched.id);
    }
  }

  for (const doc of docs) {
    if (usedDocIds.has(doc.id)) continue;
    if (!doc.sgde_id?.trim()) continue;
    const path = doc.storage_path?.trim();
    const hasContent = path ? await storageObjectReadable(admin, path) : false;
    if (hasContent) {
      skipped += 1;
      continue;
    }
    const res = await repairOneDoc({
      client,
      admin,
      caseId,
      doc,
      sgdeId: doc.sgde_id.trim(),
    });
    if ('error' in res) {
      failed += 1;
      errors.push(`${doc.name}: ${res.error}`);
    } else {
      repaired += 1;
    }
    usedDocIds.add(doc.id);
  }

  if (importSgdeOnly) {
    const existingNames = new Set<string>();
    for (const row of docs) {
      if (row.name) existingNames.add(String(row.name));
    }
    let sortOrder = await nextSortOrderForCase(admin, caseId, notebookCode);

    for (const leaf of sgdeLeaves) {
      if (usedLeafIds.has(leaf.id)) continue;
      const res = await importLeaf({
        client,
        admin,
        caseId,
        leaf,
        notebookCode,
        sortOrder: sortOrder++,
        existingNames,
      });
      if ('error' in res) {
        failed += 1;
        errors.push(`${leaf.name}: ${res.error}`);
      } else {
        imported += 1;
      }
    }
  }

  const parts = [
    repaired ? `${repaired} reparado(s)` : null,
    imported ? `${imported} importado(s) desde SGDE` : null,
    skipped ? `${skipped} ya en Storage` : null,
    failed ? `${failed} fallo(s)` : null,
  ].filter(Boolean);

  return {
    ok: failed === 0,
    repaired,
    imported,
    failed,
    skipped,
    errors,
    message: parts.join(' · ') || 'Sin cambios en Storage.',
  };
}
