import type { Document } from '../types';
import type { ExpedienteInstanciaCode } from './expediente-notebook';

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
  const cdo =
    segments.find((s) => /\d*cdo/i.test(s) || /cuaderno/i.test(s)) ??
    (segments.length >= 2 ? segments[1] : segments[0]);
  if (!cdo) return null;
  const inst = instanciaFromSgdeFolderPath(folderPath);
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

function sortTreeNodes(nodes: ExpedienteTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
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
    const segments = splitSgdeFolderPath(doc.sgdeFolderPath);
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

  if (localOnly.length > 0) {
    roots.push({
      id: 'folder:local',
      name: 'Piezas locales',
      kind: 'folder',
      children: localOnly.map((doc) => ({
        id: doc.id,
        name: doc.name || 'Documento',
        kind: 'file' as const,
        doc,
      })),
    });
  }

  sortTreeNodes(roots);
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
