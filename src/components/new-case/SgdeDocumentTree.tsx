import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, FileText, Folder } from 'lucide-react';
import type { SgdePreflightTreeNode } from '../../lib/sgde-api';

type Props = {
  nodes: SgdePreflightTreeNode[];
  disabled?: boolean;
  onPreview: (file: { id: string; name: string }) => void;
  defaultExpandedDepth?: number;
  depth?: number;
};

export function SgdeDocumentTree({
  nodes,
  disabled,
  onPreview,
  defaultExpandedDepth = 2,
  depth = 0,
}: Props) {
  return (
    <ul className={depth === 0 ? 'space-y-0.5' : 'ml-4 border-l border-violet-100 pl-2 space-y-0.5'}>
      {nodes.map((node) => (
        <SgdeDocumentTreeNode
          key={`${node.kind}-${node.id}`}
          node={node}
          disabled={disabled}
          onPreview={onPreview}
          defaultExpandedDepth={defaultExpandedDepth}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function SgdeDocumentTreeNode({
  node,
  disabled,
  onPreview,
  defaultExpandedDepth,
  depth,
}: {
  node: SgdePreflightTreeNode;
  disabled?: boolean;
  onPreview: (file: { id: string; name: string }) => void;
  defaultExpandedDepth: number;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < defaultExpandedDepth);

  if (node.kind === 'file') {
    return (
      <li className="flex items-center gap-2 rounded-md py-1 pr-1 hover:bg-white/60">
        <FileText className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-800" title={node.name}>
          {node.name}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPreview({ id: node.id, name: node.name })}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-violet-800 hover:bg-violet-50 disabled:opacity-50"
        >
          <Eye className="h-3 w-3" />
          Ver
        </button>
      </li>
    );
  }

  const children = node.children || [];
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 text-left hover:bg-white/50"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-violet-700" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-700" />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
        <span className="text-[11px] font-semibold text-slate-800">{node.name}</span>
        <span className="text-[10px] text-slate-500">({countFiles(children)})</span>
      </button>
      {open && children.length > 0 ? (
        <SgdeDocumentTree
          nodes={children}
          disabled={disabled}
          onPreview={onPreview}
          defaultExpandedDepth={defaultExpandedDepth}
          depth={depth + 1}
        />
      ) : null}
    </li>
  );
}

function countFiles(nodes: SgdePreflightTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === 'file') n += 1;
    else if (node.children?.length) n += countFiles(node.children);
  }
  return n;
}
