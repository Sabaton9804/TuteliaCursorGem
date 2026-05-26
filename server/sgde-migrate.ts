import type { SupabaseClient } from '@supabase/supabase-js';
import {
  flattenSgdePdfLeaves,
  sgdeLeafDisplayPath,
  type SgdeClient,
  type SgdePdfLeaf,
  type SgdeTreeNode,
} from './sgde-client';
import { extractSegundaFieldsFromSgdeLeaves, type SegundaFieldsExtract } from './sgde-segunda-extract';
import {
  buildPreflightTreeFromPdfLeaves,
  sgdeTreeToPreflightDocumentTree,
  type SgdePreflightTreeNode,
} from './sgde-preflight-tree';
import {
  insertCaseDocumentRowsAdmin,
  nextSortOrderForCase,
  sanitizeCaseDocumentLogicalName,
  uploadCaseAttachmentAdmin,
} from './case-document-storage';

export type SgdePreflightStatus =
  | 'listo'
  | 'incompleto'
  | 'sin_documentos'
  | 'no_encontrado'
  | 'solo_compartidos'
  | 'error_login';

export type SgdePreflightPdfFile = {
  id: string;
  name: string;
  path: string;
};

export type { SgdePreflightTreeNode };

export type SgdePreflightResult = {
  ok: boolean;
  status: SgdePreflightStatus;
  originRadicado: string;
  sgdeRootId: string | null;
  rootName: string | null;
  pdfCount: number;
  recommendedFound: string[];
  recommendedMissing: string[];
  sampleFiles: string[];
  pdfFiles: SgdePreflightPdfFile[];
  documentTree: SgdePreflightTreeNode[];
  segundaExtract: SegundaFieldsExtract | null;
  message: string;
};

const RECOMMENDED_HINTS: Array<{ key: string; patterns: RegExp[] }> = [
  { key: 'sentencia_fallo', patterns: [/sentencia/i, /fallo/i, /providencia/i] },
  {
    key: 'impugnacion_memorial',
    patterns: [
      /impugn/i,
      /memorial/i,
      /AutoConcedeImpugnacion/i,
      /escrito.*impugn/i,
      /apelaci[oó]n/i, // nombre erróneo en SGDE/juzgado; no se muestra al usuario
    ],
  },
  { key: 'notificacion', patterns: [/notific/i, /constancia/i] },
];

function matchRecommended(leaf: SgdePdfLeaf, patterns: RegExp[]): boolean {
  const blob = `${leaf.name} ${leaf.tipoDocumental || ''}`;
  return patterns.some((re) => re.test(blob));
}

function evaluateRecommended(leaves: SgdePdfLeaf[]): {
  found: string[];
  missing: string[];
} {
  const found: string[] = [];
  const missing: string[] = [];
  for (const { key, patterns } of RECOMMENDED_HINTS) {
    if (leaves.some((l) => matchRecommended(l, patterns))) found.push(key);
    else missing.push(key);
  }
  return { found, missing };
}

export function sgdeFilenameToProtocolName(raw: string, orden?: string): string {
  const base = raw.replace(/\.[^.]+$/i, '').trim() || 'DocumentoSgde';
  const words = base.split(/[^a-zA-Z0-9]+/).filter((w) => w.length > 0);
  let titled =
    words.length > 0
      ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
      : 'DocumentoSgde';
  if (orden && /^\d+$/.test(orden)) {
    const ord = orden.padStart(2, '0');
    titled = `${titled}${ord}`;
  }
  if (titled.length > 36) titled = titled.slice(0, 36);
  return titled.endsWith('.pdf') ? titled : `${titled}.pdf`;
}

export async function preflightSgdeOriginExpediente(
  client: SgdeClient,
  originRadicadoRaw: string,
  opts?: { sgdeNodeIdHint?: string | null; emailDigest?: string | null }
): Promise<SgdePreflightResult> {
  const originRadicado = originRadicadoRaw.replace(/\D/g, '');
  if (originRadicado.length !== 23) {
    return {
      ok: false,
      status: 'no_encontrado',
      originRadicado,
      sgdeRootId: null,
      rootName: null,
      pdfCount: 0,
      recommendedFound: [],
      recommendedMissing: RECOMMENDED_HINTS.map((h) => h.key),
      sampleFiles: [],
      pdfFiles: [],
      documentTree: [],
      segundaExtract: null,
      message: 'El radicado de origen debe tener 23 dígitos (CUI nacional).',
    };
  }

  const rootId = await client.buscarExpedienteNodeId(originRadicado, {
    nodeIdHint: opts?.sgdeNodeIdHint,
  });
  if (rootId) {
    console.info(`[sgde/preflight] CUI ${originRadicado} → nodo ${rootId.slice(0, 8)}…`);
  } else {
    console.info(`[sgde/preflight] CUI ${originRadicado} → sin nodo en SGDE`);
  }
  if (!rootId) {
    return {
      ok: false,
      status: 'no_encontrado',
      originRadicado,
      sgdeRootId: null,
      rootName: null,
      pdfCount: 0,
      recommendedFound: [],
      recommendedMissing: [],
      sampleFiles: [],
      pdfFiles: [],
      documentTree: [],
      segundaExtract: null,
      message:
        `No se encontró en SGDE el CUI ${originRadicado}. Si lo ve en la grilla del portal, pulse Actualizar de nuevo o pegue abajo el enlace al abrir ese expediente en SGDE. ` +
        'Si solo está en Mis compartidos → Con el despacho, use el mismo enlace desde allí.',
    };
  }

  const rootName = await client.getNodeName(rootId);
  const { leaves, tree: sgdeTree } = await client.collectExpedienteForPreflight(rootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado,
  });
  const documentTree =
    flattenSgdePdfLeaves(sgdeTree).length > 0
      ? sgdeTreeToPreflightDocumentTree(sgdeTree)
      : buildPreflightTreeFromPdfLeaves(leaves);
  const { found, missing } = evaluateRecommended(leaves);
  const pdfFiles: SgdePreflightPdfFile[] = leaves.map((l) => ({
    id: l.id,
    name: l.name,
    path: sgdeLeafDisplayPath(l),
  }));
  const sampleFiles = pdfFiles.slice(0, 12).map((f) => f.path);
  const folderCount = new Set(leaves.map((l) => l.folderPath).filter(Boolean)).size;

  let segundaExtract: SegundaFieldsExtract | null = null;
  if (leaves.length > 0) {
    try {
      segundaExtract = await extractSegundaFieldsFromSgdeLeaves(
        client,
        leaves,
        opts?.emailDigest || undefined
      );
    } catch (e) {
      console.warn('[sgde/preflight] extract segunda fields:', e);
    }
  }

  if (leaves.length === 0) {
    return {
      ok: false,
      status: 'sin_documentos',
      originRadicado,
      sgdeRootId: rootId,
      rootName: rootName || null,
      pdfCount: 0,
      recommendedFound: found,
      recommendedMissing: missing,
      sampleFiles,
      pdfFiles,
      documentTree,
      segundaExtract,
      message:
        'El expediente existe en SGDE pero no hay PDF en las carpetas visitadas (revise cuadernos como 01CdoPrincipal dentro de Primera Instancia).',
    };
  }

  const incompleto = missing.includes('sentencia_fallo') || missing.includes('impugnacion_memorial');
  const status: SgdePreflightStatus = incompleto ? 'incompleto' : 'listo';
  return {
    ok: status === 'listo',
    status,
    originRadicado,
    sgdeRootId: rootId,
    rootName: rootName || null,
    pdfCount: leaves.length,
    recommendedFound: found,
    recommendedMissing: missing,
    sampleFiles,
    pdfFiles,
    documentTree,
    segundaExtract,
    message:
      status === 'listo'
        ? `SGDE listo: ${leaves.length} PDF en ${folderCount || 'varias'} carpeta(s) (p. ej. Primera Instancia / cuaderno principal).`
        : `Expediente en SGDE con ${leaves.length} PDF(s) en carpetas anidadas, pero faltan piezas recomendadas (${missing.join(', ')}). Puede migrar igualmente.`,
  };
}

export type MigrateSgdeOriginResult = {
  sgdeRootId: string;
  migrated: number;
  skipped: number;
  failed: number;
  errors: string[];
  documentIds: string[];
};

export async function migrateSgdeOriginToCase(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  originRadicado: string;
  sgdeRootId?: string;
  sgdeNodeIdHint?: string | null;
  notebookCode: string;
  maxFiles?: number;
  force?: boolean;
}): Promise<MigrateSgdeOriginResult> {
  const { client, admin, caseId, notebookCode } = opts;
  const originRadicado = opts.originRadicado.replace(/\D/g, '');
  const maxFiles = opts.maxFiles ?? 80;
  const force = opts.force === true;

  let rootId = String(opts.sgdeRootId || '').trim();
  if (!rootId) {
    rootId =
      (await client.buscarExpedienteNodeId(originRadicado, {
        nodeIdHint: opts?.sgdeNodeIdHint,
      })) || '';
  }
  if (!rootId) throw new Error('Expediente de origen no encontrado en SGDE.');

  if (!force) {
    const { count } = await admin
      .from('case_documents')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .eq('type', 'sgde_migrate');
    if ((count ?? 0) > 0) {
      return {
        sgdeRootId: rootId,
        migrated: 0,
        skipped: count ?? 0,
        failed: 0,
        errors: ['Ya existen documentos migrados desde SGDE en este expediente. Use force=true para reintentar.'],
        documentIds: [],
      };
    }
  }

  const leaves = (
    await client.collectPdfLeavesForExpediente(rootId, {
      maxSearchDocs: maxFiles + 50,
      originRadicado,
    })
  ).slice(0, maxFiles);

  let sortOrder = await nextSortOrderForCase(admin, caseId, notebookCode);
  const errors: string[] = [];
  const documentIds: string[] = [];
  let migrated = 0;
  let failed = 0;

  const existingNames = new Set<string>();
  const { data: existing } = await admin
    .from('case_documents')
    .select('name')
    .eq('case_id', caseId);
  for (const row of existing || []) {
    if (row?.name) existingNames.add(String(row.name));
  }

  for (const leaf of leaves) {
    try {
      const downloaded = await client.downloadNodeContent(leaf.id);
      if (!downloaded?.buffer?.length) {
        failed += 1;
        errors.push(`Sin contenido PDF: ${leaf.name}`);
        continue;
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

      const up = await uploadCaseAttachmentAdmin(admin, caseId, logicalName, downloaded.buffer, 'application/pdf');
      if ('error' in up) {
        failed += 1;
        errors.push(`${leaf.name}: ${up.error.message}`);
        continue;
      }

      const docRows = [
        {
          case_id: caseId,
          name: logicalName.replace(/\.pdf$/i, ''),
          original_name: leaf.name,
          type: 'sgde_migrate',
          content_type: 'application/pdf',
          size: downloaded.buffer.length,
          storage_path: up.path,
          is_from_link: false,
          sort_order: sortOrder++,
          notebook_code: notebookCode,
          sgde_id: leaf.id,
          sgde_folder_path: leaf.folderPath || null,
          sgde_sync_status: 'linked',
        },
      ];
      const ins = await insertCaseDocumentRowsAdmin(admin, docRows);
      if (ins.error) {
        failed += 1;
        errors.push(`${leaf.name}: ${ins.error.message}`);
        continue;
      }
      const inserted = (ins.data as { id: string }[] | null)?.[0];
      if (inserted?.id) documentIds.push(String(inserted.id));
      migrated += 1;
    } catch (e) {
      failed += 1;
      errors.push(`${leaf.name}: ${String((e as Error)?.message || e)}`);
    }
  }

  const now = new Date().toISOString();
  await admin
    .from('cases')
    .update({
      sgde_id: rootId,
      sgde_linked_at: now,
      sgde_sync_status: 'linked',
      updated_at: now,
    })
    .eq('id', caseId);

  return {
    sgdeRootId: rootId,
    migrated,
    skipped: 0,
    failed,
    errors,
    documentIds,
  };
}

/** Resumen rápido de nodos en árbol (para logs). */
export function countSgdeTreeNodes(node: SgdeTreeNode): { folders: number; files: number } {
  let folders = 0;
  let files = 0;
  const walk = (n: SgdeTreeNode) => {
    if (n.isFolder) {
      folders += 1;
      for (const ch of n.children || []) walk(ch);
    } else files += 1;
  };
  walk(node);
  return { folders, files };
}
