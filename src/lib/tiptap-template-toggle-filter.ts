import type { JSONContent } from '@tiptap/core';
import type { DocumentTemplateToggleDef } from '../types';
import { docToStorage, isTiptapStorage } from './tiptap-template-storage';

const TIPTAP_PREFIX = 'tiptap:';

/** Qué toggles están activos según estado explícito o `defaultOn`. */
export function buildActiveToggleIds(
  defs: DocumentTemplateToggleDef[],
  state: Record<string, boolean> | undefined,
): Set<string> {
  const active = new Set<string>();
  for (const d of defs) {
    const v = state?.[d.id];
    const on = v !== undefined ? v : d.defaultOn;
    if (on) active.add(d.id);
  }
  return active;
}

function filterNode(node: JSONContent, active: Set<string>, knownIds: Set<string>): JSONContent | null {
  const tk = typeof node.attrs?.toggleKey === 'string' ? node.attrs.toggleKey.trim() : '';
  if (tk) {
    if (knownIds.has(tk)) {
      if (!active.has(tk)) return null;
    }
    // Si el id ya no está en la plantilla (huérfano), no ocultar: evita perder texto por error.
  }

  if (!node.content?.length) {
    return { ...node };
  }

  const nextContent: JSONContent[] = [];
  for (const child of node.content) {
    const fc = filterNode(child, active, knownIds);
    if (fc != null) nextContent.push(fc);
  }

  if (node.type === 'listItem' && nextContent.length === 0) return null;
  if ((node.type === 'bulletList' || node.type === 'orderedList') && nextContent.length === 0) return null;
  if (node.type === 'tableRow' && nextContent.length === 0) return null;
  if (node.type === 'table' && nextContent.length === 0) return null;

  return { ...node, content: nextContent };
}

/** Elimina del documento los nodos con `toggleKey` no activo (solo ids conocidos en la plantilla). */
export function filterTiptapDocByToggleKeys(
  doc: JSONContent,
  activeToggleIds: Set<string>,
  knownToggleIds: Set<string>,
): JSONContent {
  const filtered = filterNode(doc, activeToggleIds, knownToggleIds);
  return filtered ?? { type: 'doc', content: [{ type: 'paragraph' }] };
}

/**
 * Si `raw` es JSON TipTap y hay definiciones de toggles, aplica el filtro antes de sustituir variables.
 */
export function applyToggleFilterToContenidoBase(
  raw: string | null | undefined,
  defs: DocumentTemplateToggleDef[],
  state: Record<string, boolean> | undefined,
): string | null | undefined {
  if (raw == null || !String(raw).trim()) return raw;
  const s = String(raw).trim();
  if (!isTiptapStorage(s) || !defs.length) return raw;
  try {
    const doc = JSON.parse(s.slice(TIPTAP_PREFIX.length)) as JSONContent;
    if (doc?.type !== 'doc') return raw;
    const active = buildActiveToggleIds(defs, state);
    const known = new Set(defs.map((d) => d.id));
    const next = filterTiptapDocByToggleKeys(doc, active, known);
    return docToStorage(next);
  } catch {
    return raw;
  }
}
