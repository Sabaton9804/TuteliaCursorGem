import type { JSONContent } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import mammoth from 'mammoth';
import { WORD_REVIEW_RICH_EXTENSIONS } from './word-review-rich-extensions';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Garantiza un documento TipTap válido (evita `doc` vacío o `{}` guardado en BD que deja el editor en blanco).
 */
export function ensureTipTapDocJSON(input: JSONContent | Record<string, unknown> | null | undefined): JSONContent {
  if (!input || typeof input !== 'object') return EMPTY_DOC;
  const o = input as JSONContent;
  if (o.type !== 'doc') return EMPTY_DOC;
  const content = Array.isArray(o.content) ? o.content : [];
  if (content.length === 0) return EMPTY_DOC;
  return o;
}

/** Longitud aproximada del texto visible (para comparar guardado vs .docx). */
export function tipTapDocApproxPlainTextLen(doc: JSONContent | null | undefined): number {
  if (!doc || typeof doc !== 'object') return 0;
  let n = 0;
  const walk = (node: JSONContent) => {
    if (node.type === 'text' && typeof node.text === 'string') n += node.text.length;
    if (node.type === 'hardBreak') n += 1;
    if (Array.isArray(node.content)) for (const c of node.content) walk(c);
  };
  if (doc.type === 'doc' && Array.isArray(doc.content)) {
    for (const c of doc.content) walk(c);
  }
  return n;
}

/** Texto plano del documento TipTap (para patrones de sección; mismo recorrido que la longitud aprox.). */
export function tipTapDocPlainString(doc: JSONContent | null | undefined): string {
  if (!doc || typeof doc !== 'object') return '';
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
    if (node.type === 'hardBreak') parts.push('\n');
    if (Array.isArray(node.content)) for (const c of node.content) walk(c);
  };
  if (doc.type === 'doc' && Array.isArray(doc.content)) {
    for (const c of doc.content) walk(c);
  }
  return parts.join('');
}

export function isTipTapDocSubstantivelyEmpty(doc: JSONContent, maxTrivialChars = 32): boolean {
  return tipTapDocApproxPlainTextLen(doc) <= maxTrivialChars;
}

/**
 * Elige la semilla del editor de revisión.
 * Por defecto manda el **.docx** del expediente: `review_markup_json` a menudo quedó truncado o
 * desactualizado y no debe ganar en empate. Solo se conserva lo guardado si el usuario añadió
 * claramente más texto en Tutelia que lo que trae el archivo (edición sustancial).
 */
export function resolveWordReviewSeedDoc(
  saved: JSONContent | null | undefined,
  mammoth: JSONContent | null | undefined,
): JSONContent {
  const m = mammoth ? ensureTipTapDocJSON(mammoth) : null;
  const s = saved ? ensureTipTapDocJSON(saved) : null;
  if (!m || tipTapDocApproxPlainTextLen(m) < 40) return s ?? EMPTY_DOC;
  if (!s || isTipTapDocSubstantivelyEmpty(s)) return m;

  const a = tipTapDocApproxPlainTextLen(s);
  const b = tipTapDocApproxPlainTextLen(m);

  /** Texto guardado muy superior al del Word → respetar trabajo del usuario en Tutelia. */
  if (a > b + 700 && a > Math.floor(b * 1.08)) return s;

  return m;
}

/**
 * Quita párrafos HTML de mammoth que son avisos «Bloque opcional…».
 *
 * Importante: **no** usar un solo `<p>…Bloque opcional…</p>` con `[\s\S]*?` entre apertura y
 * «Bloque opcional»: eso cruza `</p><p>` y borra **todo el documento** desde el primer párrafo
 * hasta el bloque opcional (p. ej. desaparece «DISPONE» y el dispositivo en revisión Word).
 */
export function stripBloqueOpcionalHintsFromMammothHtml(html: string): string {
  return html.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (paragraph) =>
    /Bloque opcional/i.test(paragraph) ? '' : paragraph,
  );
}

/**
 * Mammoth convierte tablas Word en `<table>`. `generateJSON` + extensiones de tabla en el editor de
 * revisión suelen perder filas o el texto que sigue; sustituir cada tabla por sus `<p>` (o texto de
 * celdas) evita ese vacío sin tocar el .docx original.
 */
export function flattenMammothTablesForTipTapHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body><div id="tutelia-mm-root">${html}</div></body></html>`,
      'text/html',
    );
    const root = doc.getElementById('tutelia-mm-root');
    if (!root) return html;

    let guard = 0;
    while (root.querySelector('table') && guard++ < 800) {
      const table = root.querySelector('table')!;
      const frag = doc.createDocumentFragment();
      const innerPs = table.querySelectorAll('p');
      if (innerPs.length) {
        innerPs.forEach((p) => {
          frag.appendChild(p.cloneNode(true));
        });
      } else {
        table.querySelectorAll('td, th').forEach((cell) => {
          const t = cell.textContent?.replace(/\s+/g, ' ').trim();
          if (!t) return;
          const p = doc.createElement('p');
          p.textContent = t;
          frag.appendChild(p);
        });
      }
      table.parentNode?.insertBefore(frag, table);
      table.remove();
    }
    return root.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Mammoth (`extractRawText`) concatena párrafos con `\n\n` (ver raw-text.js del paquete).
 * Si HTML→TipTap pierde el dispositivo pero el plano del .docx es más rico, reconstruimos solo con texto.
 */
function mammothRawPlainToTipTapDoc(rawPlain: string): JSONContent {
  const paras = rawPlain
    .split(/\n\n+/)
    .map((p) => p.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (paras.length === 0) return EMPTY_DOC;
  return {
    type: 'doc',
    content: paras.map((t) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: t }],
    })),
  };
}

export async function docxArrayBufferToTipTapSeedDoc(buf: ArrayBuffer): Promise<JSONContent> {
  let html = '';
  let rawPlain = '';
  try {
    const [htmlRes, rawRes] = await Promise.all([
      mammoth.convertToHtml({ arrayBuffer: buf }),
      mammoth.extractRawText({ arrayBuffer: buf }),
    ]);
    html = htmlRes.value ?? '';
    rawPlain = (rawRes.value ?? '').trim();
  } catch {
    const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
    html = value ?? '';
  }

  const flattened = flattenMammothTablesForTipTapHtml(html.trim());
  const cleaned = stripBloqueOpcionalHintsFromMammothHtml(valueOrEmptyParagraph(flattened));
  const primaryJson = ensureTipTapDocJSON(generateJSON(cleaned, WORD_REVIEW_RICH_EXTENSIONS));
  const primaryLen = tipTapDocApproxPlainTextLen(primaryJson);
  const flatP = tipTapDocPlainString(primaryJson);

  if (rawPlain.length < 40) return primaryJson;

  const fallback = mammothRawPlainToTipTapDoc(rawPlain);
  const fallbackLen = tipTapDocApproxPlainTextLen(fallback);
  if (fallbackLen <= primaryLen) return primaryJson;

  const hasDisponeP = /\bDISPONE\b/i.test(flatP);
  const hasDisponeR = /\bDISPONE\b/i.test(rawPlain);
  const hasAccionP = /\bLa acción de tutela\b/i.test(flatP);
  const hasAccionR = /\bLa acción de tutela\b/i.test(rawPlain);

  const shouldUseRawPlain =
    fallbackLen > primaryLen + 100 &&
    (fallbackLen > Math.floor(primaryLen * 1.12) + 120 ||
      (!hasDisponeP && hasDisponeR) ||
      (!hasAccionP && hasAccionR) ||
      (primaryLen < 900 && fallbackLen > 1800));

  return shouldUseRawPlain ? ensureTipTapDocJSON(fallback) : primaryJson;
}

function valueOrEmptyParagraph(html: string): string {
  const t = html?.trim();
  if (!t) return '<p></p>';
  return t;
}
