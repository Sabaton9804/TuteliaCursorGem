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

const FONT = 'Times New Roman';
/** Tamaño en half-points (12 pt = 24) */
const BODY_SIZE = 24;

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

function textParagraph(text: string, alignment: typeof AlignmentType[keyof typeof AlignmentType]) {
  return new Paragraph({
    alignment,
    spacing: { after: 120, line: 276, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: BODY_SIZE,
      }),
    ],
  });
}

function emptyParagraph() {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

/** Convierte texto sustituido en párrafos Word con alineación tipo documento judicial. */
function paragraphsFromInforme(fullText: string): Paragraph[] {
  const lines = fullText.replace(/\r\n/g, '\n').split('\n');
  const titleIdx = lines.findIndex((l) => /INFORME DE INGRESO AL DESPACHO/i.test(l.trim()));
  const out: Paragraph[] = [];
  if (titleIdx === -1) {
    for (const line of lines) {
      if (!line.trim()) out.push(emptyParagraph());
      else out.push(textParagraph(line.trim(), AlignmentType.JUSTIFIED));
    }
    return out;
  }
  for (let i = 0; i < titleIdx; i++) {
    const L = lines[i];
    if (!L.trim()) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(L.trim(), AlignmentType.CENTER));
  }
  out.push(textParagraph(lines[titleIdx].trim(), AlignmentType.CENTER));
  const body = lines
    .slice(titleIdx + 1)
    .join('\n')
    .trim();
  for (const block of body.split(/\n\n+/)) {
    const part = block.trim();
    if (!part) continue;
    for (const line of part.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      out.push(textParagraph(t, AlignmentType.JUSTIFIED));
    }
    out.push(emptyParagraph());
  }
  return out;
}

function paragraphsFromAuto(fullText: string): Paragraph[] {
  const lines = fullText.replace(/\r\n/g, '\n').split('\n');
  const dispIdx = lines.findIndex((l) => /^DISPONE\s*:?\s*$/i.test(l.trim()) || /^DISPONE/i.test(l.trim()));
  const out: Paragraph[] = [];
  if (dispIdx === -1) {
    for (const line of lines) {
      if (!line.trim()) out.push(emptyParagraph());
      else out.push(textParagraph(line.trim(), AlignmentType.JUSTIFIED));
    }
    return out;
  }
  for (let i = 0; i < dispIdx; i++) {
    const L = lines[i];
    if (!L.trim()) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(L.trim(), AlignmentType.CENTER));
  }
  for (let i = dispIdx; i < lines.length; i++) {
    const L = lines[i];
    if (!L.trim()) {
      out.push(emptyParagraph());
      continue;
    }
    out.push(textParagraph(L.trim(), AlignmentType.JUSTIFIED));
  }
  return out;
}

export async function buildJudicialDocxBlob(opts: {
  /** Texto ya con variables sustituidas */
  fullText: string;
  kind: 'informe' | 'auto';
  /** Escudo / logo opcional (membrete desde configuración local) */
  imageDataUrl?: string | null;
}): Promise<Blob> {
  const children: Paragraph[] = [];

  if (opts.imageDataUrl?.trim()) {
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
    opts.kind === 'informe' ? paragraphsFromInforme(opts.fullText) : paragraphsFromAuto(opts.fullText);
  children.push(...bodyParas);

  children.push(emptyParagraph());
  children.push(
    textParagraph(
      'Documento generado desde Tutelia — borrador asistido. Debe revisarse jurídicamente antes de notificar.',
      AlignmentType.CENTER,
    ),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
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
