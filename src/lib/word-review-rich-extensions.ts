import type { Extensions } from '@tiptap/core';
import { buildJudicialDocEditorExtensions } from './judicial-doc-editor-extensions';

/** Misma base que `JudicialDocEditor` (semilla mammoth → TipTap y revisión). */
export const WORD_REVIEW_RICH_EXTENSIONS: Extensions = buildJudicialDocEditorExtensions({
  showComments: true,
});
