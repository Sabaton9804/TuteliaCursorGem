import type { Editor, JSONContent } from '@tiptap/core';

export type ReviewEditorComment = {
  id: string;
  body: string;
  from: number;
  to: number;
};

/**
 * Recorre el documento ProseMirror y agrupa rangos por `id` de marca `reviewComment`.
 */
export function collectReviewCommentsFromEditor(editor: Editor): ReviewEditorComment[] {
  const byId = new Map<string, ReviewEditorComment>();
  const { doc } = editor.state;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const mark of node.marks) {
      if (mark.type.name !== 'reviewComment') continue;
      const id = String(mark.attrs?.id ?? '').trim();
      const body = String(mark.attrs?.body ?? '').trim();
      if (!id) continue;
      const from = pos;
      const to = pos + node.text.length;
      const prev = byId.get(id);
      if (prev) {
        byId.set(id, {
          id,
          body: body || prev.body,
          from: Math.min(prev.from, from),
          to: Math.max(prev.to, to),
        });
      } else {
        byId.set(id, { id, body, from, to });
      }
    }
  });

  return Array.from(byId.values()).sort((a, b) => a.from - b.from);
}

/** Ids de comentarios presentes en el JSON TipTap (para podar hilos huérfanos). */
export function collectCommentIdsFromDocJson(doc: JSONContent): Set<string> {
  const ids = new Set<string>();
  const walk = (n: JSONContent) => {
    if (n.type === 'text' && n.marks?.length) {
      for (const m of n.marks) {
        if (m.type === 'reviewComment' && m.attrs && typeof m.attrs === 'object') {
          const id = String((m.attrs as Record<string, unknown>).id ?? '').trim();
          if (id) ids.add(id);
        }
      }
    }
    n.content?.forEach(walk);
  };
  walk(doc);
  return ids;
}

/**
 * Distancia desde el inicio del contenido desplazable de `scrollRoot` hasta la línea del ancla `from`
 * (para posicionar tarjetas de comentario alineadas con el texto).
 */
export function getCommentAnchorOffsetInScrollRoot(
  editor: Editor,
  scrollRoot: HTMLElement,
  from: number,
): number | null {
  try {
    const view = editor.view;
    const docSize = view.state.doc.content.size;
    const pos = Math.min(Math.max(from, 1), Math.max(1, docSize - 1));
    const coords = view.coordsAtPos(pos);
    const rootRect = scrollRoot.getBoundingClientRect();
    const y = coords.top - rootRect.top + scrollRoot.scrollTop;
    return Math.max(0, y);
  } catch {
    return null;
  }
}

export function scrollReviewCommentIntoView(editor: Editor, from: number, to: number): void {
  editor.chain().focus().setTextSelection({ from, to }).run();
  requestAnimationFrame(() => {
    try {
      const dom = editor.view.domAtPos(from).node as Node;
      const el = dom.nodeType === Node.TEXT_NODE ? dom.parentElement : (dom as HTMLElement);
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    } catch {
      /* ignore */
    }
  });
}
