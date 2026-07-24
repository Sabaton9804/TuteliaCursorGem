import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { DocumentTemplatePageLayout } from '../types';
import { mergePageLayout } from './document-template-page-layout';

const PT_PER_MM = 72 / 25.4;
const PAGE_W = 595;
const PAGE_H = 842;

function pickStandardFont(fontFamily: string) {
  const f = (fontFamily || '').toLowerCase();
  if (f.includes('courier')) return StandardFonts.Courier;
  if (f.includes('helvetica') || f.includes('arial')) return StandardFonts.Helvetica;
  return StandardFonts.TimesRoman;
}

function breakLongWord(word: string, widthOf: (s: string) => number, maxW: number): string[] {
  if (widthOf(word) <= maxW) return [word];
  const out: string[] = [];
  let buf = '';
  for (const ch of word) {
    const next = buf + ch;
    if (widthOf(next) <= maxW) {
      buf = next;
    } else {
      if (buf) out.push(buf);
      buf = ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function wrapLine(line: string, widthOf: (s: string) => number, maxW: number): string[] {
  const trimmed = line.trimEnd();
  if (!trimmed) return [''];
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (widthOf(test) <= maxW) {
      cur = test;
      continue;
    }
    if (cur) lines.push(cur);
    if (widthOf(w) <= maxW) {
      cur = w;
    } else {
      const chunks = breakLongWord(w, widthOf, maxW);
      for (let i = 0; i < chunks.length - 1; i++) lines.push(chunks[i]!);
      cur = chunks[chunks.length - 1]! || '';
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * PDF multipágina desde texto plano (Times/Helvetica según plantilla).
 * Respaldo si falla la conversión Word→PDF (`informe-docx-to-pdf.ts`); no incluye membrete rico.
 */
export async function buildInformeIngresoPlainTextPdfBlob(opts: {
  fullPlainText: string;
  pageLayout?: DocumentTemplatePageLayout | null;
}): Promise<Blob> {
  const L = mergePageLayout(opts.pageLayout);
  const margin = {
    top: L.marginMm.top * PT_PER_MM,
    right: L.marginMm.right * PT_PER_MM,
    bottom: L.marginMm.bottom * PT_PER_MM,
    left: L.marginMm.left * PT_PER_MM,
  };
  const fontSize = L.fontSizePt;
  const lineHeight = fontSize * 1.35;
  const footerSize = Math.max(7, fontSize - 3);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(pickStandardFont(L.fontFamily));
  const widthOf = (s: string) => font.widthOfTextAtSize(s, fontSize);
  const maxTextW = PAGE_W - margin.left - margin.right;
  const footerH = footerSize * 1.6;
  const minBaselineY = margin.bottom + footerH;

  const raw = opts.fullPlainText.replace(/\r\n/g, '\n').trim();
  const physicalLines: string[] = [];
  for (const block of raw.split(/\n/)) {
    const wrapped = wrapLine(block, widthOf, maxTextW);
    for (const wl of wrapped) physicalLines.push(wl);
  }
  if (physicalLines.length === 0) physicalLines.push('(Sin texto)');

  const footer =
    'Jurion — informe de ingreso (expediente digital). Revise el Word en Generar documentos si aplica.';

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - margin.top;

  const drawFooter = () => {
    const fw = font.widthOfTextAtSize(footer, footerSize);
    const fx = Math.max(margin.left, (PAGE_W - fw) / 2);
    page.drawText(footer, {
      x: fx,
      y: margin.bottom,
      size: footerSize,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  };

  for (const pl of physicalLines) {
    if (y - fontSize < minBaselineY + lineHeight * 0.25) {
      drawFooter();
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - margin.top;
    }
    page.drawText(pl || ' ', {
      x: margin.left,
      y: y - fontSize,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  }
  drawFooter();

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
