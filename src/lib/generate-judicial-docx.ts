import type { JSONContent } from '@tiptap/core';
import {
  AlignmentType,
  Document,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from 'docx';
import type { DocumentTemplatePageLayout } from '../types';
import { fontSizeToHalfPoints, mergePageLayout } from './document-template-page-layout';
import { membreteDocJsonToDocxParagraphs } from './membrete-docx-paras';
import { MARCA_CUERPO_INFORME } from './plantilla-variables';
import { isTiptapDocJsonInput, tiptapJsonToDocxParagraphs } from './tiptap-to-docx';

/** mm → twip (vía pulgadas). */
function mmToTwip(mm: number): number {
  return convertInchesToTwip(mm / 25.4);
}

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

function imageType(dataUrl: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  if (dataUrl.includes('image/png')) return 'png';
  if (dataUrl.includes('image/gif')) return 'gif';
  if (dataUrl.includes('image/bmp')) return 'bmp';
  return 'jpg';
}

function textParagraph(
  text: string,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType],
  style: DocBodyStyle,
) {
  return new Paragraph({
    alignment,
    spacing: { after: 120, line: 276, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({
        text,
        font: style.font,
        size: style.sizeHalfPoints,
      }),
    ],
  });
}

function emptyParagraph() {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

/** Texto plano ya sustituido: título y cabecera centrados, cuerpo justificado, cierre centrado. */
function paragraphsFromInformePlain(fullText: string, style: DocBodyStyle): Paragraph[] {
  const lines = fullText.replace(/\r\n/g, '\n').split('\n');
  const titleIdx = lines.findIndex((l) => /INFORME DE INGRESO AL DESPACHO/i.test(l.trim()));
  const out: Paragraph[] = [];
  if (titleIdx === -1) {
    for (const line of lines) {
      if (!line.trim()) out.push(emptyParagraph());
      else out.push(textParagraph(line.trim(), AlignmentType.JUSTIFIED, style));
    }
    return out;
  }
  for (let i = 0; i < titleIdx; i++) {
    const L = lines[i];
    if (!L.trim()) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(L.trim(), AlignmentType.CENTER, style));
  }
  out.push(textParagraph(lines[titleIdx].trim(), AlignmentType.CENTER, style));

  const afterTitle = lines.slice(titleIdx + 1);
  const idxMarca = afterTitle.findIndex((l) => l.includes(MARCA_CUERPO_INFORME));
  const idxEnLa = afterTitle.findIndex((l) => /^En la /i.test(l.trim()));
  const splitIdx = idxMarca >= 0 ? idxMarca : idxEnLa >= 0 ? idxEnLa : -1;
  const cabeza = splitIdx === -1 ? [] : afterTitle.slice(0, splitIdx);
  for (const L of cabeza) {
    if (!L.trim()) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(L.trim(), AlignmentType.CENTER, style));
  }

  const tailLines = splitIdx === -1 ? afterTitle : afterTitle.slice(splitIdx);
  const tailStr = tailLines.join('\n').trim();
  if (!tailStr) return out;

  const tl = tailStr.split('\n');
  const cordIdx = tl.findIndex((l) => /^cordialmente[,:]?\s*$/i.test(l.trim()));
  if (cordIdx === -1) {
    for (const block of tailStr.split(/\n\n+/)) {
      const part = block.trim();
      if (!part) continue;
      for (const line of part.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        out.push(textParagraph(t, AlignmentType.JUSTIFIED, style));
      }
      out.push(emptyParagraph());
    }
    return out;
  }

  const antesCord = tl.slice(0, cordIdx).join('\n').trim();
  const desdeCord = tl.slice(cordIdx).join('\n').trim();

  if (antesCord) {
    for (const block of antesCord.split(/\n\n+/)) {
      const part = block.trim();
      if (!part) continue;
      for (const line of part.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        out.push(textParagraph(t, AlignmentType.JUSTIFIED, style));
      }
      out.push(emptyParagraph());
    }
  }

  for (const line of desdeCord.split('\n')) {
    const t = line.trim();
    if (!t) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(t, AlignmentType.CENTER, style));
  }
  return out;
}

function paragraphsFromInforme(fullText: string | JSONContent, style: DocBodyStyle): Paragraph[] {
  if (isTiptapDocJsonInput(fullText)) {
    return tiptapJsonToDocxParagraphs(fullText, style);
  }
  return paragraphsFromInformePlain(typeof fullText === 'string' ? fullText : '', style);
}

function paragraphsFromAutoPlain(fullText: string, style: DocBodyStyle): Paragraph[] {
  const lines = fullText.replace(/\r\n/g, '\n').split('\n');
  const dispIdx = lines.findIndex((l) => /^DISPONE\s*:?\s*$/i.test(l.trim()) || /^DISPONE/i.test(l.trim()));
  const out: Paragraph[] = [];
  if (dispIdx === -1) {
    for (const line of lines) {
      if (!line.trim()) out.push(emptyParagraph());
      else out.push(textParagraph(line.trim(), AlignmentType.JUSTIFIED, style));
    }
    return out;
  }
  for (let i = 0; i < dispIdx; i++) {
    const L = lines[i];
    if (!L.trim()) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(L.trim(), AlignmentType.CENTER, style));
  }
  for (let i = dispIdx; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim()) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(L.trim(), AlignmentType.JUSTIFIED, style));
  }
  return out;
}

function paragraphsFromAuto(fullText: string | JSONContent, style: DocBodyStyle): Paragraph[] {
  if (isTiptapDocJsonInput(fullText)) {
    return tiptapJsonToDocxParagraphs(fullText, style);
  }
  return paragraphsFromAutoPlain(typeof fullText === 'string' ? fullText : '', style);
}

export async function buildJudicialDocxBlob(opts: {
  /** Texto o documento TipTap (JSON) ya con variables sustituidas */
  fullText: string | JSONContent;
  kind: 'informe' | 'auto';
  /** Escudo / logo opcional (membrete desde configuración local) */
  imageDataUrl?: string | null;
  /** Por plantilla; null = predeterminado de la app (Times 12 pt, márgenes 25 mm). */
  pageLayout?: DocumentTemplatePageLayout | null;
  /** Membrete TipTap guardado (JSON); si produce párrafos, sustituye la imagen única clásica. */
  membreteDocJson?: string | null;
}): Promise<Blob> {
  const L = mergePageLayout(opts.pageLayout);
  const style: DocBodyStyle = {
    font: L.fontFamily,
    sizeHalfPoints: fontSizeToHalfPoints(L.fontSizePt),
  };

  const children: Paragraph[] = [];

  const richParas = opts.membreteDocJson?.trim()
    ? membreteDocJsonToDocxParagraphs(opts.membreteDocJson.trim(), style)
    : [];
  if (richParas.length > 0) {
    children.push(...richParas);
  } else if (opts.imageDataUrl?.trim()) {
    try {
      const data = dataUrlToUint8Array(opts.imageDataUrl.trim());
      const it = imageType(opts.imageDataUrl);
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: [
            new ImageRun({
              data,
              transformation: { width: 140, height: 140 },
              type: it === 'jpg' ? 'jpg' : it,
            }),
          ],
        }),
      );
    } catch {
      /* omitir imagen si falla */
    }
  }

  const bodyParas =
    opts.kind === 'informe' ? paragraphsFromInforme(opts.fullText, style) : paragraphsFromAuto(opts.fullText, style);
  children.push(...bodyParas);

  children.push(emptyParagraph());
  children.push(
    textParagraph(
      'Documento generado desde Tutelia — borrador asistido. Debe revisarse jurídicamente antes de notificar.',
      AlignmentType.CENTER,
      style,
    ),
  );

  const m = L.marginMm;
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: mmToTwip(m.top),
              right: mmToTwip(m.right),
              bottom: mmToTwip(m.bottom),
              left: mmToTwip(m.left),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

export function descargarBlob(blob: Blob, nombreArchivo: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function nombreArchivoDocx(radicadoSlug: string, sufijo: 'Informe-ingreso' | 'Auto-admisorio') {
  const safe = radicadoSlug.replace(/[^\w\-]+/g, '_').slice(0, 80);
  return `${sufijo}_${safe}.docx`;
}
