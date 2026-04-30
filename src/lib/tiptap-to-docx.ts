import type { JSONContent } from '@tiptap/core';
import {
  AlignmentType,
  ImageRun,
  LineRuleType,
  Paragraph,
  TextRun,
  UnderlineType,
  type ParagraphChild,
} from 'docx';
import { fontSizeToHalfPoints } from './document-template-page-layout';

/** Misma forma que el estilo de cuerpo en `generate-judicial-docx` / membrete. */
export type TiptapDocxBodyStyle = { font: string; sizeHalfPoints: number };

function parseCssFontSizeToPt(css: string): number | null {
  const t = css.trim().toLowerCase();
  const pt = t.match(/^([\d.]+)\s*pt$/);
  if (pt) return Number(pt[1]);
  const px = t.match(/^([\d.]+)\s*px$/);
  if (px) return (Number(px[1]) * 72) / 96;
  return null;
}

function alignmentFromTipTap(
  align: string | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (align) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf('base64,');
  if (idx === -1) throw new Error('Imagen inválida (se esperaba data URL base64).');
  const base64 = dataUrl.slice(idx + 7);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function imageTypeFromDataUrl(dataUrl: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  if (dataUrl.includes('image/png')) return 'png';
  if (dataUrl.includes('image/gif')) return 'gif';
  if (dataUrl.includes('image/bmp')) return 'bmp';
  return 'jpg';
}

const DOCX_IMAGE_DEFAULT_PX = 120;
const DOCX_IMAGE_MIN_PX = 16;
const DOCX_IMAGE_MAX_PX = 2000;

function parseAttrPx(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function imageDisplayDimensionsFromAttrs(attrs: Record<string, unknown> | undefined): {
  width: number;
  height: number;
} {
  const wRaw = parseAttrPx(attrs?.width);
  const hRaw = parseAttrPx(attrs?.height);
  const clamp = (n: number) =>
    Math.round(Math.min(DOCX_IMAGE_MAX_PX, Math.max(DOCX_IMAGE_MIN_PX, n)));
  if (wRaw != null && hRaw != null) return { width: clamp(wRaw), height: clamp(hRaw) };
  if (wRaw != null) {
    const w = clamp(wRaw);
    return { width: w, height: w };
  }
  if (hRaw != null) {
    const h = clamp(hRaw);
    return { width: h, height: h };
  }
  return { width: DOCX_IMAGE_DEFAULT_PX, height: DOCX_IMAGE_DEFAULT_PX };
}

function paragraphSpacing() {
  return { after: 120, line: 276, lineRule: LineRuleType.AUTO };
}

function inlineToRuns(nodes: JSONContent[] | undefined, style: TiptapDocxBodyStyle, forceBold = false): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  if (!nodes) return children;
  for (const n of nodes) {
    if (n.type === 'text') {
      const marks = n.marks ?? [];
      const bold = forceBold || marks.some((m) => m.type === 'bold');
      const italics = marks.some((m) => m.type === 'italic');
      const underline = marks.some((m) => m.type === 'underline');
      let runFont = style.font;
      let runSizeHp = style.sizeHalfPoints;
      for (const m of marks) {
        if (m.type !== 'textStyle' || !m.attrs || typeof m.attrs !== 'object') continue;
        const a = m.attrs as Record<string, unknown>;
        if (typeof a.fontFamily === 'string' && a.fontFamily.trim()) {
          runFont = a.fontFamily.trim().replace(/^['"]|['"]$/g, '');
        }
        if (typeof a.fontSize === 'string') {
          const pt = parseCssFontSizeToPt(a.fontSize);
          if (pt != null) runSizeHp = fontSizeToHalfPoints(pt);
        }
      }
      children.push(
        new TextRun({
          text: n.text ?? '',
          font: runFont,
          size: runSizeHp,
          bold: bold || undefined,
          italics: italics || undefined,
          underline: underline ? { type: UnderlineType.SINGLE } : undefined,
        }),
      );
    } else if (n.type === 'hardBreak') {
      children.push(
        new TextRun({
          text: '',
          break: 1,
          font: style.font,
          size: style.sizeHalfPoints,
        }),
      );
    } else if (n.type === 'image') {
      const attrs = n.attrs as Record<string, unknown> | undefined;
      const src = String(attrs?.src ?? '').trim();
      if (!src.startsWith('data:')) continue;
      try {
        const data = dataUrlToUint8Array(src);
        const it = imageTypeFromDataUrl(src);
        const { width, height } = imageDisplayDimensionsFromAttrs(attrs);
        children.push(
          new ImageRun({
            data,
            transformation: { width, height },
            type: it === 'jpg' ? 'jpg' : it,
          }),
        );
      } catch {
        /* omitir */
      }
    } else if (n.type === 'expedienteVariable') {
      const key = String((n.attrs as Record<string, unknown> | undefined)?.key ?? '').trim();
      const token = key ? `{{${key}}}` : '';
      children.push(
        new TextRun({
          text: token,
          font: style.font,
          size: style.sizeHalfPoints,
        }),
      );
    }
  }
  return children;
}

function paragraphFromNode(block: JSONContent, style: TiptapDocxBodyStyle, forceBold = false): Paragraph {
  const align = alignmentFromTipTap((block.attrs as { textAlign?: string } | undefined)?.textAlign);
  const runs = inlineToRuns(block.content, style, forceBold);
  return new Paragraph({
    alignment: align,
    spacing: paragraphSpacing(),
    children: runs.length ? runs : [],
  });
}

function blockToParagraphs(block: JSONContent, style: TiptapDocxBodyStyle): Paragraph[] {
  if (block.type === 'paragraph') return [paragraphFromNode(block, style, false)];
  if (block.type === 'heading') return [paragraphFromNode(block, style, true)];
  if (block.type === 'horizontalRule') {
    return [new Paragraph({ spacing: paragraphSpacing(), children: [] })];
  }
  if (block.type === 'blockquote') {
    const acc: Paragraph[] = [];
    for (const c of block.content ?? []) {
      acc.push(...blockToParagraphs(c, style));
    }
    return acc;
  }
  if (block.type === 'bulletList' || block.type === 'orderedList') {
    const ordered = block.type === 'orderedList';
    const out: Paragraph[] = [];
    let idx = 1;
    for (const li of block.content ?? []) {
      if (li.type !== 'listItem') continue;
      for (const inner of li.content ?? []) {
        if (inner.type !== 'paragraph') continue;
        const prefix = ordered ? `${idx++}. ` : '• ';
        const runs: ParagraphChild[] = [
          new TextRun({
            text: prefix,
            font: style.font,
            size: style.sizeHalfPoints,
            bold: true,
          }),
          ...inlineToRuns(inner.content, style, false),
        ];
        out.push(
          new Paragraph({
            alignment: alignmentFromTipTap((inner.attrs as { textAlign?: string } | undefined)?.textAlign),
            spacing: paragraphSpacing(),
            children: runs,
          }),
        );
      }
    }
    return out;
  }
  return [];
}

function walkDocContent(nodes: JSONContent[] | undefined, style: TiptapDocxBodyStyle): Paragraph[] {
  const out: Paragraph[] = [];
  if (!nodes) return out;
  for (const block of nodes) {
    out.push(...blockToParagraphs(block, style));
  }
  return out;
}

function normalizeToDocJson(json: unknown): JSONContent | null {
  if (json != null && typeof json === 'object' && !Array.isArray(json)) {
    const o = json as JSONContent;
    if (o.type === 'doc' && Array.isArray(o.content)) return o;
  }
  if (typeof json === 'string') {
    const t = json.trim();
    if (t.startsWith('tiptap:')) {
      try {
        const p = JSON.parse(t.slice('tiptap:'.length)) as JSONContent;
        if (p && typeof p === 'object' && p.type === 'doc' && Array.isArray(p.content)) return p;
      } catch {
        return null;
      }
      return null;
    }
    if (!t.startsWith('{')) return null;
    try {
      const p = JSON.parse(t) as JSONContent;
      if (p && typeof p === 'object' && p.type === 'doc' && Array.isArray(p.content)) return p;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Convierte un documento TipTap (JSON ProseMirror) en párrafos `docx`,
 * preservando negrita, cursiva, subrayado, alineación de párrafo y bloques habituales.
 */
export function tiptapJsonToDocxParagraphs(json: unknown, style: TiptapDocxBodyStyle): Paragraph[] {
  const doc = normalizeToDocJson(json);
  if (!doc) return [];
  return walkDocContent(doc.content, style);
}

/** Útil para bifurcar lógica string vs TipTap sin duplicar el criterio de parseo. */
export function isTiptapDocJsonInput(input: unknown): boolean {
  return normalizeToDocJson(input) != null;
}
