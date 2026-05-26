import type { SgdePdfLeaf, SgdeTreeNode } from './sgde-client';

export type SgdePreflightTreeNode = {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  children?: SgdePreflightTreeNode[];
};

function isPdfishFileName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  if (!lower || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return false;
  return lower.endsWith('.pdf') || !lower.includes('.');
}

function treeNodeToPreflight(node: SgdeTreeNode): SgdePreflightTreeNode | null {
  if (node.isFolder) {
    const children = (node.children || [])
      .map(treeNodeToPreflight)
      .filter((c): c is SgdePreflightTreeNode => c != null);
    if (children.length === 0) return null;
    return {
      id: node.id,
      name: node.name,
      kind: 'folder',
      children,
    };
  }
  if (!isPdfishFileName(node.name)) return null;
  return { id: node.id, name: node.name, kind: 'file' };
}

export function sgdeTreeToPreflightDocumentTree(root: SgdeTreeNode): SgdePreflightTreeNode[] {
  if (root.isFolder) {
    const children = (root.children || [])
      .map(treeNodeToPreflight)
      .filter((c): c is SgdePreflightTreeNode => c != null);
    return children;
  }
  const one = treeNodeToPreflight(root);
  return one ? [one] : [];
}

/** Cuando los PDF vienen solo de búsqueda ANCESTOR (sin árbol), arma carpetas desde folderPath. */
export function buildPreflightTreeFromPdfLeaves(leaves: SgdePdfLeaf[]): SgdePreflightTreeNode[] {
  const roots: SgdePreflightTreeNode[] = [];

  const findOrCreateFolder = (
    list: SgdePreflightTreeNode[],
    folderId: string,
    folderName: string
  ): SgdePreflightTreeNode => {
    let node = list.find((n) => n.kind === 'folder' && n.name === folderName);
    if (!node) {
      node = { id: folderId, name: folderName, kind: 'folder', children: [] };
      list.push(node);
    }
    if (!node.children) node.children = [];
    return node;
  };

  for (const leaf of leaves) {
    const segments = (leaf.folderPath || '')
      .split(/\s*\/\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    let currentList = roots;
    let pathKey = 'root';
    for (const seg of segments) {
      pathKey += `/${seg}`;
      const folder = findOrCreateFolder(currentList, `folder:${pathKey}`, seg);
      currentList = folder.children!;
    }
    currentList.push({
      id: leaf.id,
      name: leaf.name,
      kind: 'file',
    });
  }

  return roots;
}
