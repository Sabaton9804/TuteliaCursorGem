import type { Document } from '../types';
import type { ExpedienteInstanciaCode } from './expediente-notebook';
import { NOTEBOOK_SI_IMPUGNACION } from './expediente-notebook';
import { compareExpedientePiezas } from './expediente-document-order';

export type ExpedienteTreeNode = {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  doc?: Document;
  children?: ExpedienteTreeNode[];
};

const FOLDER_SEP = /\s*\/\s*/;

export function splitSgdeFolderPath(path: string | undefined | null): string[] {
  return (path || '')
    .split(FOLDER_SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function instanciaFromSgdeFolderPath(path: string | undefined | null): ExpedienteInstanciaCode {
  const first = splitSgdeFolderPath(path)[0] || '';
  if (/segunda\s*instancia/i.test(first)) return 'SI';
  return 'PI';
}

/** Cuaderno SGDE (p. ej. 01CdoPrincipal) a partir de la ruta de carpeta. */
export function sgdeCuadernoFromFolderPath(
  folderPath: string | undefined | null
): { code: string; label: string } | null {
  const segments = splitSgdeFolderPath(folderPath);
  if (segments.length === 0) return null;
  const inst = instanciaFromSgdeFolderPath(folderPath);
  const cdo =
    segments.find((s) => /\d*cdo/i.test(s) || /cuaderno/i.test(s)) ??
    (segments.length >= 2 ? segments[1] : segments[0]);
  if (!cdo) return null;
  if (inst === 'SI' && /impugn/i.test(cdo)) {
    return { code: NOTEBOOK_SI_IMPUGNACION, label: 'Impugnación' };
  }
  const slug = cdo
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, 36);
  if (!slug) return null;
  return { code: `${inst}_${slug}`, label: cdo };
}

function findOrCreateFolder(
  list: ExpedienteTreeNode[],
  folderId: string,
  folderName: string
): ExpedienteTreeNode {
  let node = list.find((n) => n.kind === 'folder' && n.name === folderName);
  if (!node) {
    node = { id: folderId, name: folderName, kind: 'folder', children: [] };
    list.push(node);
  }
  if (!node.children) node.children = [];
  return node;
}

/**
 * En SGDE a veces un PDF contenedor («14. Respuesta…») envuelve el subexpediente real.
 * Para la vista en Jurion, se omite ese segmento y se muestra «EXPEDIENTE…» al mismo nivel.
 */
export function flattenSgdePathSegmentsForDisplay(segments: string[]): string[] {
  if (segments.length < 2) return segments;
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const next = segments[i + 1];
    const numberedWrapper = /^\d+\.\s/.test(seg);
    const nextIsExpediente = Boolean(next && /^expediente\b/i.test(next.trim()));
    if (numberedWrapper && nextIsExpediente) {
      continue;
    }
    out.push(seg);
  }
  return out;
}

function sortTreeNodes(nodes: ExpedienteTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (a.kind === 'file' && b.kind === 'file' && a.doc && b.doc) {
      const cmp = compareExpedientePiezas(a.doc, b.doc);
      if (cmp !== 0) return cmp;
    }
    return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
  });
  for (const n of nodes) {
    if (n.children?.length) sortTreeNodes(n.children);
  }
}

/** Árbol de carpetas SGDE a partir de las piezas del expediente (misma lógica que el preflight SGDE). */
export function buildExpedienteTreeFromDocs(docs: Document[]): ExpedienteTreeNode[] {
  const roots: ExpedienteTreeNode[] = [];
  const localOnly: Document[] = [];

  for (const doc of docs) {
    const segments = flattenSgdePathSegmentsForDisplay(splitSgdeFolderPath(doc.sgdeFolderPath));
    if (segments.length === 0) {
      localOnly.push(doc);
      continue;
    }
    let currentList = roots;
    let pathKey = 'root';
    for (const seg of segments) {
      pathKey += `/${seg}`;
      const folder = findOrCreateFolder(currentList, `folder:${pathKey}`, seg);
      currentList = folder.children!;
    }
    currentList.push({
      id: doc.id,
      name: doc.name || 'Documento',
      kind: 'file',
      doc,
    });
  }

  sortTreeNodes(roots);

  // Piezas solo Jurion al final (tras carpetas SGDE), para no “romper” 01, 02, 03… del Principal.
  if (localOnly.length > 0) {
    const localChildren = localOnly
      .slice()
      .sort((a, b) => compareExpedientePiezas(a, b))
      .map((doc) => ({
        id: doc.id,
        name: doc.name || 'Documento',
        kind: 'file' as const,
        doc,
      }));
    roots.push({
      id: 'folder:local',
      name: 'Piezas locales',
      kind: 'folder',
      children: localChildren,
    });
  }

  return roots;
}

export function countFilesInTree(nodes: ExpedienteTreeNode[]): number {
  let n = 0;
  const walk = (list: ExpedienteTreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'file') n += 1;
      else if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return n;
}

function nodeMatchesQuery(node: ExpedienteTreeNode, q: string): boolean {
  if (node.kind === 'file' && node.doc) {
    const name = (node.doc.name || '').toLowerCase();
    const orig = (node.doc.originalName || '').toLowerCase();
    return name.includes(q) || orig.includes(q);
  }
  return node.name.toLowerCase().includes(q);
}

function filterNodes(nodes: ExpedienteTreeNode[], q: string): ExpedienteTreeNode[] {
  const out: ExpedienteTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const children = filterNodes(node.children || [], q);
      if (children.length > 0 || node.name.toLowerCase().includes(q)) {
        out.push({ ...node, children });
      }
    } else if (nodeMatchesQuery(node, q)) {
      out.push(node);
    }
  }
  return out;
}

export function filterExpedienteTree(nodes: ExpedienteTreeNode[], query: string): ExpedienteTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  return filterNodes(nodes, q);
}

export function collectExpandedFolderIds(nodes: ExpedienteTreeNode[], depth = 0): Set<string> {
  const ids = new Set<string>();
  const walk = (list: ExpedienteTreeNode[], d: number) => {
    for (const n of list) {
      if (n.kind === 'folder') {
        if (d < 2) ids.add(n.id);
        if (n.children) walk(n.children, d + 1);
      }
    }
  };
  walk(nodes, depth);
  return ids;
}

/** Todos los ids de carpeta presentes en el árbol (para validar estado expandido tras refetch). */
export function collectFolderIdsInTree(nodes: ExpedienteTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: ExpedienteTreeNode[]) => {
    for (const n of list) {
      if (n.kind === 'folder') {
        ids.add(n.id);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

/** Carpetas ancestro de una pieza (para mantener visible la ruta al seleccionar/refrescar). */
export function folderIdsOnPathToDoc(
  nodes: ExpedienteTreeNode[],
  docId: string | null | undefined
): Set<string> {
  const ids = new Set<string>();
  if (!docId) return ids;
  const walk = (list: ExpedienteTreeNode[], ancestors: string[]): boolean => {
    for (const n of list) {
      if (n.kind === 'file' && n.doc?.id === docId) {
        for (const id of ancestors) ids.add(id);
        return true;
      }
      if (n.kind === 'folder' && n.children) {
        if (walk(n.children, [...ancestors, n.id])) return true;
      }
    }
    return false;
  };
  walk(nodes, []);
  return ids;
}

/** Fusiona expansión previa del usuario con la ruta de la pieza seleccionada. */
export function mergeExpandedFolderIds(
  tree: ExpedienteTreeNode[],
  prev: Set<string>,
  selectedDocId?: string | null
): Set<string> {
  const validIds = collectFolderIdsInTree(tree);
  const next = new Set<string>();
  for (const id of prev) {
    if (validIds.has(id)) next.add(id);
  }
  for (const id of folderIdsOnPathToDoc(tree, selectedDocId)) {
    next.add(id);
  }
  if (next.size === 0) return collectExpandedFolderIds(tree);
  return next;
}
