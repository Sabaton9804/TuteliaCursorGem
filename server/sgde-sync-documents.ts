import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient, SgdePdfLeaf } from './sgde-client';
import { repairStorageFromSgde } from './sgde-repair-storage';
import {
  buildSgdeExpedienteProperties,
  inferActCodeForSgdeTipo,
  tipoDocumentalSgdeFromFileName,
  tipoDocumentalSgdeSegundaFromFileName,
  uploadOrderPriority,
  uploadOrderPrioritySegunda,
} from './sgde-tutela-metadata';
import { CASE_DOCUMENTS_BUCKET, sanitizeCaseDocumentLogicalName } from './case-document-storage';
import {
  caseHasCautelarNotebook,
  NOTEBOOK_PI_C01_PRINCIPAL,
  NOTEBOOK_PI_C02_CAUTELAR,
  NOTEBOOK_SI_IMPUGNACION,
  normalizeNotebookCode,
} from '../src/lib/expediente-notebook.ts';
import type { ExpedienteCuadernoExtra } from '../src/lib/expediente-extra-cuadernos.ts';
import { sgdeSegundaOriginWriteBlockedMessage } from './sgde-segunda-impugnacion.ts';

export type SgdeDocumentSyncStatus = 'linked' | 'local_only' | 'sgde_only';

function parseCuadernosExtra(raw: unknown): ExpedienteCuadernoExtra[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => ({
      code: String((e as { code?: string }).code || '').trim(),
      label: String((e as { label?: string }).label || '').trim(),
    }))
    .filter((e) => e.code);
}

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
  repaired: number;
  imported: number;
  repairFailed: number;
  items: SgdeDocumentSyncItem[];
  sgdeOnlyItems: SgdeDocumentSyncItem[];
  errors: string[];
  message: string;
  sgdeRootId: string;
};

const SGDE_PATH_SEGUNDA_IMPUGNACION = 'Segunda instancia / Impugnación';

type CaseRow = {
  id: string;
  court_id: string;
  radicado: string;
  origin_radicado: string | null;
  claimant: string;
  defendant: string;
  sgde_id: string | null;
  case_type: string | null;
  expediente_cuadernos_extra?: unknown;
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
  sgde_folder_path: string | null;
  act_code: string | null;
};

function buildFolderPathToId(
  rows: Array<{ folder_path?: string | null; sgde_folder_node_id?: string | null }>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const fp = String(row.folder_path || '').trim();
    const fid = String(row.sgde_folder_node_id || '').trim();
    if (fp && fid) out.set(fp, fid);
  }
  return out;
}

/** Máximo rama:orden ya usado en cada carpeta SGDE (no global del expediente). */
function buildOrdenByFolderFromLeaves(
  leaves: SgdePdfLeaf[],
  folderPathToId: Map<string, string>
): Map<string, number> {
  const ordenByFolder = new Map<string, number>();
  for (const leaf of leaves) {
    const fp = (leaf.folderPath || '').trim();
    if (!fp) continue;
    const folderId = folderPathToId.get(fp);
    if (!folderId) continue;
    const ord = parseInt(String(leaf.orden || ''), 10);
    if (!Number.isFinite(ord) || ord <= 0) continue;
    ordenByFolder.set(folderId, Math.max(ordenByFolder.get(folderId) || 0, ord));
  }
  return ordenByFolder;
}

function resolveUploadFolder(
  doc: DocRow,
  defaultNotebookCode: string,
  folderIdByNotebook: Map<string, string>,
  folderPathByNotebook: Map<string, string>,
  folderPathToId: Map<string, string>,
  principalFolderId: string
): { folderId: string; folderPath: string } {
  const docPath = doc.sgde_folder_path?.trim();
  if (docPath) {
    const fid = folderPathToId.get(docPath);
    if (fid) return { folderId: fid, folderPath: docPath };
  }
  const docNb = normalizeNotebookCode(doc.notebook_code || defaultNotebookCode);
  const folderId =
    folderIdByNotebook.get(docNb) ||
    (docNb === NOTEBOOK_PI_C02_CAUTELAR
      ? folderIdByNotebook.get(NOTEBOOK_PI_C02_CAUTELAR)
      : undefined) ||
    principalFolderId;
  const folderPath =
    folderPathByNotebook.get(docNb) ||
    (docNb === NOTEBOOK_PI_C02_CAUTELAR
      ? 'Primera instancia / Medidas cautelares'
      : docNb === NOTEBOOK_SI_IMPUGNACION
        ? SGDE_PATH_SEGUNDA_IMPUGNACION
        : 'Primera instancia / Principal');
  return { folderId, folderPath };
}

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
  const pathLower = String(leaf.folderPath || '').toLowerCase();
  const pathIsCautelar = /cautelar/.test(pathLower);
  const pathIsPrincipal = /principal/.test(pathLower) && !pathIsCautelar;
  const nameHits: DocRow[] = [];
  for (const d of docs) {
    if (usedDocIds.has(d.id)) continue;
    const docKey = normalizeDocKey(d.name);
    if (docKey && (docKey === leafKey || leafKey.includes(docKey) || docKey.includes(leafKey))) {
      nameHits.push(d);
    }
  }
  if (nameHits.length === 0) return null;
  const preferred = nameHits.find((d) => {
    const nb = normalizeNotebookCode(d.notebook_code);
    if (pathIsCautelar) return nb === NOTEBOOK_PI_C02_CAUTELAR;
    if (pathIsPrincipal) return nb !== NOTEBOOK_PI_C02_CAUTELAR;
    return true;
  });
  return preferred || nameHits[0] || null;
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
    .select(
      'id, court_id, radicado, origin_radicado, claimant, defendant, sgde_id, case_type, expediente_cuadernos_extra',
    )
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow?.id) throw new Error('Expediente no encontrado.');
  const c = caseRow as CaseRow;
  const isSegunda = c.case_type === 'tutela_segunda';

  const radicadoSegunda23 = String(c.radicado || '').replace(/\D/g, '').slice(0, 23);
  const originRadicado23 = String(c.origin_radicado || '')
    .replace(/\D/g, '')
    .slice(0, 23);
  const radicado23 =
    isSegunda && originRadicado23.length === 23 ? originRadicado23 : radicadoSegunda23;
  if (radicado23.length !== 23) {
    throw new Error('Radicado inválido (23 dígitos).');
  }

  let sgdeRootId = String(c.sgde_id || '').trim();
  if (!sgdeRootId) {
    sgdeRootId = (await client.buscarExpedienteNodeId(radicado23)) || '';
  }
  if (!sgdeRootId) {
    throw new Error('El expediente no está vinculado a SGDE. Use «Vincular» o el preflight del traslado.');
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
    .eq('notebook_code', isSegunda ? NOTEBOOK_SI_IMPUGNACION : notebookCode)
    .maybeSingle();
  if (folderMap?.sgde_folder_node_id) {
    principalFolderId = String(folderMap.sgde_folder_node_id);
  }

  if (!principalFolderId && isSegunda) {
    const imp = await client.ensureSegundaInstanciaImpugnacion(sgdeRootId);
    if (imp.ok === false) {
      errors.push(imp.error);
    } else {
      principalFolderId = imp.impugnacionFolderId;
      await admin.from('case_sgde_folder_map').upsert(
        {
          court_id: c.court_id,
          case_id: caseId,
          notebook_code: NOTEBOOK_SI_IMPUGNACION,
          sgde_folder_node_id: imp.impugnacionFolderId,
          folder_path: SGDE_PATH_SEGUNDA_IMPUGNACION,
        },
        { onConflict: 'case_id,notebook_code' }
      );
    }
  }

  if (!principalFolderId && !isSegunda) {
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

  const folderIdByNotebook = new Map<string, string>();
  if (principalFolderId) {
    folderIdByNotebook.set(
      isSegunda ? NOTEBOOK_SI_IMPUGNACION : normalizeNotebookCode(notebookCode),
      principalFolderId,
    );
  }
  const folderPathByNotebook = new Map<string, string>();
  if (principalFolderId) {
    folderPathByNotebook.set(
      isSegunda ? NOTEBOOK_SI_IMPUGNACION : normalizeNotebookCode(notebookCode),
      isSegunda ? SGDE_PATH_SEGUNDA_IMPUGNACION : 'Primera instancia / Principal',
    );
  }

  const { data: allFolderMaps } = await admin
    .from('case_sgde_folder_map')
    .select('sgde_folder_node_id, notebook_code, folder_path')
    .eq('case_id', caseId);
  for (const row of allFolderMaps || []) {
    const nb = normalizeNotebookCode(String(row.notebook_code || ''));
    const fid = String(row.sgde_folder_node_id || '').trim();
    if (nb && fid) {
      folderIdByNotebook.set(nb, fid);
      if (row.folder_path) folderPathByNotebook.set(nb, String(row.folder_path));
    }
  }
  const folderPathToId = buildFolderPathToId(allFolderMaps || []);

  const extras = parseCuadernosExtra(c.expediente_cuadernos_extra);
  if (caseHasCautelarNotebook(extras) && !folderIdByNotebook.get(NOTEBOOK_PI_C02_CAUTELAR)) {
    const cautelar = await client.ensurePrimeraInstanciaCautelar(sgdeRootId);
    if (cautelar.ok === false) {
      errors.push(`Cuaderno cautelares SGDE: ${cautelar.error}`);
    } else {
      folderIdByNotebook.set(NOTEBOOK_PI_C02_CAUTELAR, cautelar.cautelarFolderId);
      folderPathByNotebook.set(
        NOTEBOOK_PI_C02_CAUTELAR,
        'Primera instancia / Medidas cautelares'
      );
      await admin.from('case_sgde_folder_map').upsert(
        {
          court_id: c.court_id,
          case_id: caseId,
          notebook_code: NOTEBOOK_PI_C02_CAUTELAR,
          sgde_folder_node_id: cautelar.cautelarFolderId,
          folder_path: 'Primera instancia / Medidas cautelares',
        },
        { onConflict: 'case_id,notebook_code' }
      );
    }
  }

  const sgdeLeaves = await client.collectPdfLeavesForExpediente(sgdeRootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado: radicado23,
  });

  const { data: docsRaw } = await admin
    .from('case_documents')
    .select('id, name, type, storage_path, content_type, notebook_code, sgde_id, sgde_folder_path, act_code')
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
    const orderPriority = isSegunda ? uploadOrderPrioritySegunda : uploadOrderPriority;
    const sorted = [...localOnlyDocs].sort(
      (a, b) => orderPriority(a.name, a.type, a.act_code) - orderPriority(b.name, b.type, b.act_code),
    );
    const ordenByFolder = buildOrdenByFolderFromLeaves(sgdeLeaves, folderPathToId);
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
      const logicalName = sanitizeCaseDocumentLogicalName(String(doc.name || ''), 'documento.pdf');
      const docNb = normalizeNotebookCode(doc.notebook_code || notebookCode);
      const { folderId: targetFolderId, folderPath: targetFolderPath } = resolveUploadFolder(
        doc,
        isSegunda ? NOTEBOOK_SI_IMPUGNACION : notebookCode,
        folderIdByNotebook,
        folderPathByNotebook,
        folderPathToId,
        principalFolderId
      );
      if (!targetFolderId) {
        uploadFailed += 1;
        errors.push(
          `${doc.name}: no hay carpeta SGDE destino (${isSegunda ? 'Segunda instancia / Impugnación' : 'Principal'}).`,
        );
        continue;
      }
      const orden = (ordenByFolder.get(targetFolderId) || 0) + 1;
      ordenByFolder.set(targetFolderId, orden);
      const tipo = isSegunda
        ? tipoDocumentalSgdeSegundaFromFileName(doc.name, doc.type, doc.act_code)
        : tipoDocumentalSgdeFromFileName(doc.name, doc.type, doc.act_code);
      const up = await client.uploadDocumentToFolder({
        folderNodeUuid: targetFolderId,
        radicado23,
        buffer: buf,
        fileName: logicalName,
        contentType: 'application/pdf',
        tipoDocumental: tipo,
        expedienteMetadata: props,
        orden,
      });
      if (up.ok === false) {
        uploadFailed += 1;
        errors.push(`${doc.name}: ${up.error}`);
        continue;
      }
      uploaded += 1;
      usedDocIds.add(doc.id);
      const patch: Record<string, unknown> = {
        sgde_folder_path: targetFolderPath,
        sgde_sync_status: 'linked',
        notebook_code:
          docNb === NOTEBOOK_PI_C01_PRINCIPAL || docNb === NOTEBOOK_PI_C02_CAUTELAR
            ? docNb
            : normalizeNotebookCode(doc.notebook_code || notebookCode),
      };
      if (!doc.act_code?.trim()) {
        const act = inferActCodeForSgdeTipo(doc.name, doc.type);
        if (act) patch.act_code = act;
      }
      if (up.sgdeDocId) patch.sgde_id = up.sgdeDocId;
      await admin.from('case_documents').update(patch).eq('id', doc.id);
      items.push({
        status: 'linked',
        documentId: doc.id,
        name: doc.name,
        sgdeId: up.sgdeDocId,
        sgdeFolderPath: targetFolderPath,
        notebookCode: docNb,
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
    localOnly ? `${localOnly} solo en Jurion` : null,
    sgdeOnly ? `${sgdeOnly} solo en SGDE` : null,
    uploaded ? `${uploaded} subido(s) a SGDE` : null,
    uploadFailed ? `${uploadFailed} fallo(s) al subir` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let repaired = 0;
  let imported = 0;
  let repairFailed = 0;
  const repairErrors: string[] = [];

  try {
    const repair = await repairStorageFromSgde({
      client,
      admin,
      caseId,
      sgdeRootId,
      caseType: c.case_type,
      originRadicado: radicado23,
      importSgdeOnly: true,
    });
    repaired = repair.repaired;
    imported = repair.imported;
    repairFailed = repair.failed;
    repairErrors.push(...repair.errors);
  } catch (e) {
    repairFailed += 1;
    repairErrors.push(String((e as Error)?.message || e));
  }

  const fullMessage = [
    message || 'Sin documentos PDF para comparar.',
    repaired ? `${repaired} PDF reparado(s) en Storage` : null,
    imported ? `${imported} importado(s) desde SGDE` : null,
    repairFailed ? `${repairFailed} fallo(s) al reparar Storage` : null,
    isSegunda && uploadFailed > 0 && errors.some((e) => /403|permiso|escritura/i.test(e))
      ? sgdeSegundaOriginWriteBlockedMessage()
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const allErrors = [...errors, ...repairErrors];

  return {
    ok: uploadFailed === 0 && repairFailed === 0,
    linked,
    localOnly,
    sgdeOnly,
    uploaded,
    uploadFailed,
    repaired,
    imported,
    repairFailed,
    items,
    sgdeOnlyItems,
    errors: allErrors,
    message: fullMessage,
    sgdeRootId,
  };
}
