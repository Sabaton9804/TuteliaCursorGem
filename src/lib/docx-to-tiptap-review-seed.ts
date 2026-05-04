import type { JSONContent } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import mammoth from 'mammoth';
import { WORD_REVIEW_RICH_EXTENSIONS } from './word-review-rich-extensions';

/** Quita párrafos HTML de mammoth que solo son avisos «Bloque opcional…». */
export function stripBloqueOpcionalHintsFromMammothHtml(html: string): string {
  return html.replace(/<p\b[^>]*>[\s\S]*?Bloque opcional[\s\S]*?<\/p>/gi, '');
}

export async function docxArrayBufferToTipTapSeedDoc(buf: ArrayBuffer): Promise<JSONContent> {
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const cleaned = stripBloqueOpcionalHintsFromMammothHtml(valueOrEmptyParagraph(html));
  return generateJSON(cleaned, WORD_REVIEW_RICH_EXTENSIONS);
}

function valueOrEmptyParagraph(html: string): string {
  const t = html?.trim();
  if (!t) return '<p></p>';
  return t;
}
