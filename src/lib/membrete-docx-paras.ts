import type { JSONContent } from '@tiptap/core';
import { AlignmentType, ImageRun, Paragraph, TextRun, type ParagraphChild } from 'docx';
import { fontSizeToHalfPoints } from './document-template-page-layout';
import { normalizeMembreteEditorDoc } from './membrete-rich-doc';

type DocBodyStyle = { font: string; sizeHalfPoints: number };

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

/** Dimensiones en píxeles CSS (96 dpi), alineadas con el editor TipTap / ImageRun de docx. */
function imageDisplayDimensionsFromAttrs(attrs: Record<string, unknown> | undefined): { width: number; height: number } {
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

/** OOXML: spacing en twentieths of a point (1 pt = 20). */
function marginPtStringToTwentieths(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const m = raw.trim().match(/^([\d.]+)\s*pt$/i);
  if (!m) return null;
  const pt = Number(m[1]);
  if (!Number.isFinite(pt)) return null;
  return Math.round(pt * 20);
}

function inlineToRuns(
  nodes: JSONContent[] | undefined,
  style: DocBodyStyle,
  forceBold = false,
): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  if (!nodes) return children;
  for (const n of nodes) {
    if (n.type === 'text') {
      const marks = n.marks ?? [];
      const bold = forceBold || marks.some((m) => m.type === 'bold');
      const italics = marks.some((m) => m.type === 'italic');
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
        /* omitir imagen inválida */
      }
    }
  }
  return children;
}

function paragraphFromNode(block: JSONContent, style: DocBodyStyle, forceBold = false): Paragraph {
  const attrs = block.attrs as Record<string, unknown> | undefined;
  const align = alignmentFromTipTap(attrs?.textAlign as string | undefined);
  const children = inlineToRuns(block.content, style, forceBold);
  const beforeTw = marginPtStringToTwentieths(attrs?.paragraphMarginBefore);
  const afterTw = marginPtStringToTwentieths(attrs?.paragraphMarginAfter);
  const spacing: { line: number; after: number; before?: number } = {
    line: 276,
    after: afterTw ?? 100,
  };
  if (beforeTw != null) spacing.before = beforeTw;
  return new Paragraph({
    alignment: align,
    spacing,
    children: children.length ? children : [],
  });
}

function walkDocContent(nodes: JSONContent[] | undefined, style: DocBodyStyle): Paragraph[] {
  const out: Paragraph[] = [];
  if (!nodes) return out;
  for (const block of nodes) {
    if (block.type === 'paragraph') {
      out.push(paragraphFromNode(block, style, false));
    } else if (block.type === 'heading') {
      out.push(paragraphFromNode(block, style, true));
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      const ordered = block.type === 'orderedList';
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
          const liAttrs = inner.attrs as Record<string, unknown> | undefined;
          const liBefore = marginPtStringToTwentieths(liAttrs?.paragraphMarginBefore);
          const liAfter = marginPtStringToTwentieths(liAttrs?.paragraphMarginAfter);
          const liSpacing: { line: number; after: number; before?: number } = {
            line: 276,
            after: liAfter ?? 80,
          };
          if (liBefore != null) liSpacing.before = liBefore;
          out.push(
            new Paragraph({
              alignment: alignmentFromTipTap(liAttrs?.textAlign as string | undefined),
              spacing: liSpacing,
              children: runs,
            }),
          );
        }
      }
    }
  }
  return out;
}

/** Convierte el JSON TipTap del membrete en párrafos docx. */
export function membreteDocJsonToDocxParagraphs(raw: string, style: DocBodyStyle): Paragraph[] {
  try {
    const parsed = JSON.parse(raw) as JSONContent;
    if (parsed.type !== 'doc') return [];
    const doc = normalizeMembreteEditorDoc(parsed);
    return walkDocContent(doc.content, style);
  } catch {
    return [];
  }
}
