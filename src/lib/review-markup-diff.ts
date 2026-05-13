import type { JSONContent } from '@tiptap/core';
import type { PreviewSketchV1 } from './review-markup-payload';
import { wordLevelDiffSnippet } from './review-markup-word-diff';

/** Texto plano de un nodo TipTap (párrafo, heading, celda, etc.). */
function flattenText(node: JSONContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (!node.content?.length) return '';
  return node.content.map((c) => flattenText(c)).join('');
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'tableCell',
  'tableHeader',
]);

function collectBlockTexts(node: JSONContent | undefined, out: string[]): void {
  if (!node) return;
  if (typeof node.type === 'string' && BLOCK_TYPES.has(node.type)) {
    const t = flattenText(node).replace(/\s+/g, ' ').trim();
    out.push(t);
    return;
  }
  if (node.content?.length) {
    for (const c of node.content) {
      collectBlockTexts(c, out);
    }
  }
}

function blockTexts(doc: JSONContent | undefined): string[] {
  const out: string[] = [];
  if (doc?.content) {
    for (const c of doc.content) {
      collectBlockTexts(c, out);
    }
  }
  return out;
}

function collectReviewCommentIds(node: JSONContent | undefined, ids: Set<string>): void {
  if (!node) return;
  if (node.type === 'text' && node.marks?.length) {
    for (const m of node.marks) {
      if (m.type === 'reviewComment' && m.attrs && typeof m.attrs === 'object') {
        const id = String((m.attrs as Record<string, unknown>).id ?? '').trim();
        if (id) ids.add(id);
      }
    }
  }
  if (node.content?.length) {
    for (const c of node.content) {
      collectReviewCommentIds(c, ids);
    }
  }
}

export type ReviewMarkupDiffSummary = {
  hasBaseline: boolean;
  blocksTotal: number;
  blocksChanged: number;
  commentCount: number;
  /** Primeros fragmentos de bloques que cambiaron (texto recortado). */
  changedSnippets: string[];
  /** Diff por palabras en los primeros bloques distintos ([-quita] [+añade]). */
  wordDiffLines: string[];
  sketchStrokeCount: number;
};

/**
 * Resumen legible entre la versión inicial (baseline) y el documento guardado al devolver.
 * Sin baseline persistido no hay comparación de texto (solo conteo de comentarios en el actual).
 */
export function summarizeReviewMarkupDiff(
  baselineDoc: JSONContent | undefined,
  currentDoc: JSONContent,
  previewSketch?: PreviewSketchV1,
): ReviewMarkupDiffSummary {
  const commentIds = new Set<string>();
  collectReviewCommentIds(currentDoc, commentIds);
  const sketchStrokeCount = previewSketch?.strokes?.length ?? 0;

  if (!baselineDoc) {
    return {
      hasBaseline: false,
      blocksTotal: blockTexts(currentDoc).length,
      blocksChanged: 0,
      commentCount: commentIds.size,
      changedSnippets: [],
      wordDiffLines: [],
      sketchStrokeCount,
    };
  }

  const a = blockTexts(baselineDoc);
  const b = blockTexts(currentDoc);
  const n = Math.max(a.length, b.length);
  const snippets: string[] = [];
  const wordDiffLines: string[] = [];
  let changed = 0;
  for (let i = 0; i < n; i += 1) {
    const left = a[i] ?? '';
    const right = b[i] ?? '';
    if (left !== right) {
      changed += 1;
      if (snippets.length < 6) {
        const preview = (right || left).slice(0, 140);
        if (preview.trim()) {
          snippets.push(preview.trim() + (preview.length >= 140 ? '…' : ''));
        } else {
          snippets.push('(bloque vacío o solo formato)');
        }
      }
      if (wordDiffLines.length < 4 && (left || right)) {
        const wd = wordLevelDiffSnippet(left, right);
        if (wd) {
          wordDiffLines.push(`Bloque ~${i + 1}: ${wd}`);
        }
      }
    }
  }

  return {
    hasBaseline: true,
    blocksTotal: b.length,
    blocksChanged: changed,
    commentCount: commentIds.size,
    changedSnippets: snippets,
    wordDiffLines,
    sketchStrokeCount,
  };
}
