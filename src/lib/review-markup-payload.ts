import type { JSONContent } from '@tiptap/core';

export type CommentThreadReply = { id: string; body: string; at: string };

/** Hilos por id de comentario (misma id que la marca TipTap `reviewComment`). */
export type CommentThreadsMap = Record<string, { replies: CommentThreadReply[] }>;

export type FreehandStrokeTool = 'pen' | 'highlighter' | 'arrow' | 'circle';

export type FreehandStrokeV1 = {
  id: string;
  tool: FreehandStrokeTool;
  color: string;
  widthPx: number;
  /** Coordenadas 0–1 respecto al rectángulo del overlay al guardar el trazo. */
  points: Array<{ x: number; y: number }>;
};

/** Anotaciones a mano alzada sobre la vista previa (no modifica el .docx). */
export type PreviewSketchV1 = { v: 1; strokes: FreehandStrokeV1[] };

export type ReviewMarkupPayloadV1 = {
  v: 1;
  doc: JSONContent;
  baselineDoc?: JSONContent;
  commentThreads?: CommentThreadsMap;
  previewSketch?: PreviewSketchV1;
};

export function emptyPreviewSketch(): PreviewSketchV1 {
  return { v: 1, strokes: [] };
}

export function isPreviewSketchV1(raw: unknown): raw is PreviewSketchV1 {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o.v === 1 && Array.isArray(o.strokes);
}
