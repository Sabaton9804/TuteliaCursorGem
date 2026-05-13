import type { JSONContent } from '@tiptap/core';

/** Quita marcas `reviewComment` del JSON TipTap antes de generar .docx/PDF (los comentarios no van al Word generado). */
export function stripReviewCommentMarksFromTipTapDoc(doc: JSONContent): JSONContent {
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === 'text' && node.marks?.length) {
      const marks = node.marks.filter((m) => m.type !== 'reviewComment');
      return { ...node, marks: marks.length ? marks : undefined };
    }
    if (node.content?.length) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  };
  return walk(doc);
}
