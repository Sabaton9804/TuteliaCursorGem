import React, { useMemo, useState } from 'react';
import { ChevronRight, FolderTree, FileText } from 'lucide-react';
import type { Document } from '../../types';
import type { ExpedienteTreeNode } from '../../lib/expediente-folder-tree';
import {
  buildExpedienteTreeFromDocs,
  collectExpandedFolderIds,
  filterExpedienteTree,
  mergeExpandedFolderIds,
  splitSgdeFolderPath,
} from '../../lib/expediente-folder-tree';

export type ExpedienteSgdeFolderTreeProps = {
  docs: Document[];
  /** Si se indica, las rutas SGDE se muestran relativas a este cuaderno. */
  cuadernoLabel?: string;
  searchQuery?: string;
  selectedDocId?: string | null;
  renderFileRow: (doc: Document, listIndex: number) => React.ReactNode;
};

function docsWithRelativePaths(docs: Document[], cuadernoLabel?: string): Document[] {
  if (!cuadernoLabel) return docs;
  return docs.map((d) => {
    const segs = splitSgdeFolderPath(d.sgdeFolderPath);
    if (segs.length === 0) return d;
    const idx = segs.findIndex(
      (s) => s === cuadernoLabel || s.toLowerCase() === cuadernoLabel.toLowerCase()
    );
    if (idx < 0) return d;
    const rel = segs.slice(idx + 1).join(' / ');
    if (!rel) return { ...d, sgdeFolderPath: undefined };
    return { ...d, sgdeFolderPath: rel };
  });
}

function FolderBranch({
  node,
  depth,
  expanded,
  onToggle,
  fileIndexRef,
  selectedDocId,
  renderFileRow,
}: {
  node: ExpedienteTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  fileIndexRef: { current: number };
  selectedDocId?: string | null;
  renderFileRow: (doc: Document, listIndex: number) => React.ReactNode;
}) {
  const pad = Math.min(depth, 10) * 12;

  if (node.kind === 'folder') {
    const open = expanded.has(node.id);
    const childCount = node.children?.length ?? 0;
    return (
      <li className="list-none">
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
          style={{ paddingLeft: pad }}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <FolderTree className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 tabular-nums text-[9px] text-slate-400">{childCount}</span>
        </button>
        {open && node.children && node.children.length > 0 ? (
          <ul className="mt-0.5 space-y-0.5">
            {node.children.map((ch) => (
              <FolderBranch
                key={ch.id}
                node={ch}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                fileIndexRef={fileIndexRef}
                selectedDocId={selectedDocId}
                renderFileRow={renderFileRow}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  if (!node.doc) return null;
  const idx = fileIndexRef.current++;
  const sel = selectedDocId === node.doc.id;
  return (
    <li className="list-none" style={{ paddingLeft: pad + 14 }}>
      <div className={sel ? 'rounded-md ring-1 ring-accent/20' : undefined}>{renderFileRow(node.doc, idx)}</div>
    </li>
  );
}

export function ExpedienteSgdeFolderTree({
  docs,
  cuadernoLabel,
  searchQuery = '',
  selectedDocId,
  renderFileRow,
}: ExpedienteSgdeFolderTreeProps) {
  const relativeDocs = useMemo(
    () => docsWithRelativePaths(docs, cuadernoLabel),
    [docs, cuadernoLabel]
  );

  const tree = useMemo(() => buildExpedienteTreeFromDocs(relativeDocs), [relativeDocs]);
  const filtered = useMemo(
    () => filterExpedienteTree(tree, searchQuery),
    [tree, searchQuery]
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => collectExpandedFolderIds(tree));

  React.useEffect(() => {
    setExpanded((prev) => mergeExpandedFolderIds(tree, prev, selectedDocId));
  }, [tree, selectedDocId]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fileIndexRef = { current: 0 };
  fileIndexRef.current = 0;

  const hasSgdePaths = docs.some((d) => splitSgdeFolderPath(d.sgdeFolderPath).length > 0);

  if (!hasSgdePaths) {
    return (
      <div className="space-y-1 pr-0.5">
        {docs.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 py-6 text-center text-[10px] text-slate-500">
            Sin piezas en este cuaderno.
          </p>
        ) : (
          docs.map((d, i) => renderFileRow(d, i))
        )}
      </div>
    );
  }

  if (filtered.length === 0) {
    return <p className="py-4 text-center text-[10px] text-slate-500">Sin coincidencias.</p>;
  }

  return (
    <ul className="space-y-0.5 pr-0.5" aria-label="Árbol de carpetas SGDE">
      {filtered.map((node) =>
        node.kind === 'folder' ? (
          <FolderBranch
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            fileIndexRef={fileIndexRef}
            selectedDocId={selectedDocId}
            renderFileRow={renderFileRow}
          />
        ) : node.doc ? (
          <li key={node.id} className="list-none">
            {renderFileRow(node.doc, fileIndexRef.current++)}
          </li>
        ) : null
      )}
    </ul>
  );
}

/** Indicador compacto cuando no hay carpetas (solo archivos sueltos en raíz). */
export function ExpedienteTreeModeHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p className="mb-1.5 shrink-0 flex items-center gap-1 px-1 text-[9px] text-slate-500">
      <FileText className="h-3 w-3 text-emerald-600" />
      Vista de carpetas al estilo SGDE
    </p>
  );
}
