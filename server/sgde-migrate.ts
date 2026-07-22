import type { SupabaseClient } from '@supabase/supabase-js';
import {
  flattenSgdePdfLeaves,
  sgdeLeafDisplayPath,
  type SgdeClient,
  type SgdePdfLeaf,
  type SgdeTreeNode,
} from './sgde-client';
import { extractSegundaFieldsFromSgdeLeaves, type SegundaFieldsExtract } from './sgde-segunda-extract';
import { probeSegundaInstanciaWriteAccess } from './sgde-segunda-impugnacion';
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
  | 'sin_permiso_escritura'
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
  segundaWriteAccess?: 'ok' | 'forbidden' | 'skipped';
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

/** Carpeta de traslado de 2ª (piezas de radicación local), no historial PI. */
export function isSgdeImpugnacionFolderPath(folderPath: string | undefined): boolean {
  const path = (folderPath || '').trim().toLowerCase();
  if (!path) return false;
  return /segunda\s*instancia/.test(path) && /impugnaci[oó]n/.test(path);
}

export function notebookCodeFromSgdeFolderPath(
  folderPath: string | undefined,
  fallback: string
): string {
  const path = (folderPath || '').trim();
  if (!path) return fallback;
  const lower = path.toLowerCase();
  const segunda = /segunda\s*instancia/.test(lower);
  if (/cautelar/.test(lower)) return 'PI_C02_CAUTELAR';
  if (/principal/.test(lower) || /01\s*cdo\s*principal|01cdoprincipal/.test(lower)) {
    return segunda ? 'SI_C01_PRINCIPAL' : 'PI_C01_PRINCIPAL';
  }
  const segments = path
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return fallback;
  const cdo =
    segments.find((s) => /\d*cdo/i.test(s) || /cuaderno/i.test(s)) ??
    (segments.length >= 2 ? segments[1] : segments[0]);
  const inst = segunda ? 'SI' : 'PI';
  const slug = cdo
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, 36);
  if (!slug) return fallback;
  if (slug === 'PRINCIPAL' || slug === 'C01_PRINCIPAL' || slug === '01CDOPRINCIPAL') {
    return inst === 'SI' ? 'SI_C01_PRINCIPAL' : 'PI_C01_PRINCIPAL';
  }
  if (slug.includes('CAUTELAR')) return 'PI_C02_CAUTELAR';
  return `${inst}_${slug}`;
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

/** Orden SGDE (rama:orden / idDocumento) para importación en secuencia del índice. */
export function sgdeLeafSortKey(leaf: SgdePdfLeaf): number {
  const orden = leaf.orden?.trim();
  if (orden && /^\d+$/.test(orden)) return parseInt(orden, 10);
  const fromName = leaf.name.replace(/\.pdf$/i, '').match(/(\d{1,4})$/);
  if (fromName) return parseInt(fromName[1], 10);
  return Number.MAX_SAFE_INTEGER;
}

export function sortSgdePdfLeavesByIndex(leaves: SgdePdfLeaf[]): SgdePdfLeaf[] {
  return [...leaves].sort((a, b) => {
    const ka = sgdeLeafSortKey(a);
    const kb = sgdeLeafSortKey(b);
    if (ka !== kb) return ka - kb;
    return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
  });
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

  const writeProbe = await probeSegundaInstanciaWriteAccess(client, rootId);
  if (writeProbe.ok === false && writeProbe.forbidden) {
    const rootNameEarly = await client.getNodeName(rootId);
    return {
      ok: false,
      status: 'sin_permiso_escritura',
      originRadicado,
      sgdeRootId: rootId,
      rootName: rootNameEarly || null,
      pdfCount: 0,
      recommendedFound: [],
      recommendedMissing: RECOMMENDED_HINTS.map((h) => h.key),
      sampleFiles: [],
      pdfFiles: [],
      documentTree: [],
      segundaExtract: null,
      message: writeProbe.message,
      segundaWriteAccess: 'forbidden',
    };
  }

  const rootName = await client.getNodeName(rootId);
  const { leaves, tree: sgdeTree } = await client.collectExpedienteForPreflight(rootId, {
    maxDepth: 12,
    maxNodes: 800,
    maxSearchDocs: 600,
    originRadicado,
  });
  const leavesOrdered = sortSgdePdfLeavesByIndex(leaves);
  const documentTree =
    flattenSgdePdfLeaves(sgdeTree).length > 0
      ? sgdeTreeToPreflightDocumentTree(sgdeTree)
      : buildPreflightTreeFromPdfLeaves(leavesOrdered);
  const { found, missing } = evaluateRecommended(leavesOrdered);
  const pdfFiles: SgdePreflightPdfFile[] = leavesOrdered.map((l) => ({
    id: l.id,
    name: l.name,
    path: sgdeLeafDisplayPath(l),
  }));
  const sampleFiles = pdfFiles.slice(0, 12).map((f) => f.path);
  const folderCount = new Set(leaves.map((l) => l.folderPath).filter(Boolean)).size;

  let segundaExtract: SegundaFieldsExtract | null = null;
  if (leavesOrdered.length > 0) {
    try {
      segundaExtract = await extractSegundaFieldsFromSgdeLeaves(
        client,
        leavesOrdered,
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
    segundaWriteAccess: writeProbe.ok ? 'ok' : 'skipped',
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

  const leaves = sortSgdePdfLeavesByIndex(
    (
      await client.collectPdfLeavesForExpediente(rootId, {
        maxSearchDocs: maxFiles + 50,
        originRadicado,
      })
    ).slice(0, maxFiles),
  );

  let sortOrder = await nextSortOrderForCase(admin, caseId, notebookCode);
  const errors: string[] = [];
  const documentIds: string[] = [];
  let migrated = 0;
  let failed = 0;
  let skippedLeaves = 0;

  const existingNames = new Set<string>();
  const existingSgdeIds = new Set<string>();
  const { data: existing } = await admin
    .from('case_documents')
    .select('name, sgde_id')
    .eq('case_id', caseId);
  for (const row of existing || []) {
    if (row?.name) existingNames.add(String(row.name));
    const sid = String(row?.sgde_id || '').trim().toLowerCase();
    if (sid) existingSgdeIds.add(sid);
  }

  for (const leaf of leaves) {
    const leafId = leaf.id.toLowerCase();
    if (existingSgdeIds.has(leafId)) {
      skippedLeaves += 1;
      continue;
    }
    // Tras radicar 2ª, Impugnación ya tiene Correo/Acta locales; no reimportar desde SGDE.
    if (isSgdeImpugnacionFolderPath(leaf.folderPath)) {
      skippedLeaves += 1;
      continue;
    }
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

      const nbFromPath = notebookCodeFromSgdeFolderPath(leaf.folderPath, notebookCode);
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
          notebook_code: nbFromPath,
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
      if (inserted?.id) {
        documentIds.push(String(inserted.id));
        existingSgdeIds.add(leafId);
      }
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
    skipped: skippedLeaves,
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
