import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient, SgdePdfLeaf } from './sgde-client';
import {
  buildSgdeExpedienteProperties,
  tipoDocumentalSgdeFromFileName,
  uploadOrderPriority,
} from './sgde-tutela-metadata';
import { CASE_DOCUMENTS_BUCKET, sanitizeCaseDocumentLogicalName } from './case-document-storage';

export type SgdeDocumentSyncStatus = 'linked' | 'local_only' | 'sgde_only';

export type SgdeDocumentSyncItem = {
  status: SgdeDocumentSyncStatus;
  name: string;
  documentId?: string;
  sgdeId?: string;
  sgdeFolderPath?: string;
  notebookCode?: string;
};

export type SyncDocumentsWithSgdeResult = {
  ok: boolean;
  linked: number;
  localOnly: number;
  sgdeOnly: number;
  uploaded: number;
  uploadFailed: number;
  items: SgdeDocumentSyncItem[];
  sgdeOnlyItems: SgdeDocumentSyncItem[];
  errors: string[];
  message: string;
  sgdeRootId: string;
};

type CaseRow = {
  id: string;
  court_id: string;
  radicado: string;
  claimant: string;
  defendant: string;
  sgde_id: string | null;
  case_type: string | null;
};

function notebookForCaseType(caseType: string | null): string {
  return caseType === 'tutela_segunda' ? 'SI_C01_PRINCIPAL' : 'PI_C01_PRINCIPAL';
}

type DocRow = {
  id: string;
  name: string;
  type: string;
  storage_path: string | null;
  content_type: string | null;
  notebook_code: string | null;
  sgde_id: string | null;
};

function normalizeDocKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function isPdfCandidate(doc: DocRow): boolean {
  if (!doc.storage_path?.trim()) return false;
  const ct = String(doc.content_type || '').toLowerCase();
  const nm = String(doc.name || '').toLowerCase();
  return ct.includes('pdf') || nm.endsWith('.pdf');
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

export async function syncDocumentsWithSgde(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  uploadMissing?: boolean;
}): Promise<SyncDocumentsWithSgdeResult> {
  const { client, admin, caseId } = opts;
  const uploadMissing = opts.uploadMissing !== false;
  const errors: string[] = [];

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('id, court_id, radicado, claimant, defendant, sgde_id, case_type')
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow?.id) throw new Error('Expediente no encontrado.');
  const c = caseRow as CaseRow;

  const radicado23 = String(c.radicado || '').replace(/\D/g, '').slice(0, 23);
  if (radicado23.length !== 23) {
    throw new Error('Radicado inválido (23 dígitos).');
  }

  let sgdeRootId = String(c.sgde_id || '').trim();
  if (!sgdeRootId) {
    sgdeRootId = (await client.buscarExpedienteNodeId(radicado23)) || '';
  }
  if (!sgdeRootId) {
    throw new Error('El expediente no está vinculado a SGDE. Use «Crear en SGDE» o «Vincular» primero.');
  }

  const { data: courtRow } = await admin
    .from('courts')
    .select('name')
    .eq('id', c.court_id)
    .maybeSingle();

  const props = buildSgdeExpedienteProperties({
    radicado23,
    claimant: c.claimant,
    defendant: c.defendant,
    courtName: courtRow?.name ? String(courtRow.name) : undefined,
  });

  const notebookCode = notebookForCaseType(c.case_type);

  let principalFolderId = '';
  const { data: folderMap } = await admin
    .from('case_sgde_folder_map')
    .select('sgde_folder_node_id, notebook_code')
    .eq('case_id', caseId)
    .eq('notebook_code', notebookCode)
    .maybeSingle();
  if (folderMap?.sgde_folder_node_id) {
    principalFolderId = String(folderMap.sgde_folder_node_id);
  }

  if (!principalFolderId) {
    const structure = await client.ensurePrimeraInstanciaPrincipal(sgdeRootId);
    if (structure.ok === false) throw new Error(structure.error);
    principalFolderId = structure.principalFolderId;
    await admin.from('case_sgde_folder_map').upsert(
      {
        court_id: c.court_id,
        case_id: caseId,
        notebook_code: notebookCode,
        sgde_folder_node_id: principalFolderId,
        folder_path: 'Primera instancia / Principal',
      },
      { onConflict: 'case_id,notebook_code' }
    );
  }

  const sgdeLeaves = await client.collectPdfLeavesForExpediente(sgdeRootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado: radicado23,
  });

  const { data: docsRaw } = await admin
    .from('case_documents')
    .select('id, name, type, storage_path, content_type, notebook_code, sgde_id')
    .eq('case_id', caseId)
    .order('sort_order', { ascending: true });

  const docs = (docsRaw || []) as DocRow[];
  const usedDocIds = new Set<string>();
  const usedLeafIds = new Set<string>();
  const items: SgdeDocumentSyncItem[] = [];

  for (const leaf of sgdeLeaves) {
    const matched = matchLeafToDoc(leaf, docs, usedDocIds);
    if (matched) {
      usedDocIds.add(matched.id);
      usedLeafIds.add(leaf.id);
      const folderPath = leaf.folderPath || undefined;
      await admin
        .from('case_documents')
        .update({
          sgde_id: leaf.id,
          sgde_folder_path: folderPath,
          sgde_sync_status: 'linked',
        })
        .eq('id', matched.id);
      items.push({
        status: 'linked',
        documentId: matched.id,
        name: matched.name,
        sgdeId: leaf.id,
        sgdeFolderPath: folderPath,
        notebookCode: matched.notebook_code || undefined,
      });
    }
  }

  let uploaded = 0;
  let uploadFailed = 0;

  const localOnlyDocs = docs.filter((d) => !usedDocIds.has(d.id) && isPdfCandidate(d));
  if (uploadMissing && localOnlyDocs.length > 0) {
    const sorted = [...localOnlyDocs].sort(
      (a, b) => uploadOrderPriority(a.name, a.type) - uploadOrderPriority(b.name, b.type)
    );
    let orden = sgdeLeaves.length + 1;
    for (const doc of sorted) {
      const path = String(doc.storage_path || '').trim();
      const { data: blob, error: dlErr } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
      if (dlErr || !blob) {
        uploadFailed += 1;
        errors.push(`${doc.name}: no se pudo leer desde Storage`);
        continue;
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      if (buf.length < 100) {
        uploadFailed += 1;
        errors.push(`${doc.name}: archivo vacío`);
        continue;
      }
      const logicalName = sanitizeCaseDocumentLogicalName(`${doc.name}.pdf`, `${doc.name}.pdf`);
      const up = await client.uploadDocumentToFolder({
        folderNodeUuid: principalFolderId,
        radicado23,
        buffer: buf,
        fileName: logicalName,
        contentType: 'application/pdf',
        tipoDocumental: tipoDocumentalSgdeFromFileName(doc.name, doc.type),
        expedienteMetadata: props,
        orden,
      });
      orden += 1;
      if (up.ok === false) {
        uploadFailed += 1;
        errors.push(`${doc.name}: ${up.error}`);
        continue;
      }
      uploaded += 1;
      usedDocIds.add(doc.id);
      const patch: Record<string, unknown> = {
        sgde_folder_path: 'Primera instancia / Principal',
        sgde_sync_status: 'linked',
      };
      if (up.sgdeDocId) patch.sgde_id = up.sgdeDocId;
      await admin.from('case_documents').update(patch).eq('id', doc.id);
      items.push({
        status: 'linked',
        documentId: doc.id,
        name: doc.name,
        sgdeId: up.sgdeDocId,
        sgdeFolderPath: 'Primera instancia / Principal',
        notebookCode: doc.notebook_code || undefined,
      });
    }
  }

  for (const doc of docs) {
    if (usedDocIds.has(doc.id)) continue;
    const status: SgdeDocumentSyncStatus = isPdfCandidate(doc) ? 'local_only' : 'local_only';
    await admin
      .from('case_documents')
      .update({ sgde_sync_status: status })
      .eq('id', doc.id);
    items.push({
      status,
      documentId: doc.id,
      name: doc.name,
      notebookCode: doc.notebook_code || undefined,
    });
  }

  const sgdeOnlyItems: SgdeDocumentSyncItem[] = [];
  for (const leaf of sgdeLeaves) {
    if (usedLeafIds.has(leaf.id)) continue;
    sgdeOnlyItems.push({
      status: 'sgde_only',
      name: leaf.name,
      sgdeId: leaf.id,
      sgdeFolderPath: leaf.folderPath,
    });
  }

  let linked = 0;
  let localOnly = 0;
  for (const it of items) {
    if (it.status === 'linked') linked += 1;
    else if (it.status === 'local_only') localOnly += 1;
  }
  const sgdeOnly = sgdeOnlyItems.length;

  const now = new Date().toISOString();
  const caseStatus =
    localOnly === 0 && sgdeOnly === 0 && uploadFailed === 0 ? 'linked' : localOnly > 0 || sgdeOnly > 0 ? 'stale' : 'error';
  await admin
    .from('cases')
    .update({
      sgde_id: sgdeRootId,
      sgde_linked_at: now,
      sgde_sync_status: uploadFailed > 0 ? 'error' : caseStatus,
      updated_at: now,
    })
    .eq('id', caseId);

  const message = [
    `${linked} sincronizado(s)`,
    localOnly ? `${localOnly} solo en Tutelia` : null,
    sgdeOnly ? `${sgdeOnly} solo en SGDE` : null,
    uploaded ? `${uploaded} subido(s) a SGDE` : null,
    uploadFailed ? `${uploadFailed} fallo(s) al subir` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    ok: uploadFailed === 0,
    linked,
    localOnly,
    sgdeOnly,
    uploaded,
    uploadFailed,
    items,
    sgdeOnlyItems,
    errors,
    message: message || 'Sin documentos PDF para comparar.',
    sgdeRootId,
  };
}
