import { extractExplicitCuiFromText } from './src/lib/reparto-origin-cui.ts';

/**
 * Detecta «acta de reparto» / «acta individual de reparto» aunque el nombre del archivo sea críptico
 * (p. ej. 12456 J51CCTO.PDF). Usado al parsear correos en server.ts.
 */

export const ACTA_REPARTO_DISPLAY_NAME = 'Acta individual de reparto.pdf';

function isPdfMagic(buf: Buffer): boolean {
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}

/** PDF.js en Node exige el build legacy (ver aviso en consola del servidor). */
async function loadPdfJsForNode() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/** Heurística /Count en el árbol de páginas cuando PDF.js no puede abrir el archivo. */
function estimatePdfPageCountFromBytes(buf: Buffer): number | null {
  const n = Math.min(buf.length, 512_000);
  const s = buf.subarray(Math.max(0, buf.length - n)).toString('latin1');
  const matches = [...s.matchAll(/\/Count\s+(\d+)/g)];
  if (matches.length === 0) return null;
  const last = Number(matches[matches.length - 1]?.[1]);
  return Number.isFinite(last) && last > 0 ? last : null;
}

async function openPdfDocument(buf: Buffer) {
  const pdfjs = await loadPdfJsForNode();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    standardFontDataUrl: undefined,
    verbosity: 0,
  });
  return loadingTask.promise;
}

/** Heurística rápida: muchos PDF del RAMA/JEPMS llevan el título en claro en los primeros bytes. */
function detectFromRawBytes(buf: Buffer): boolean {
  const n = Math.min(buf.length, 900_000);
  const s = buf.subarray(0, n).toString('latin1').toLowerCase();
  if (s.includes('acta individual de reparto')) return true;
  if (s.includes('acta de reparto')) return true;
  if (s.includes('individual de reparto') && s.includes('acta')) return true;
  return false;
}

async function detectFromPdfJs(buf: Buffer): Promise<boolean> {
  try {
    const pdf = await openPdfDocument(buf);
    const pages = Math.min(pdf.numPages, 3);
    let acc = '';
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      for (const item of tc.items) {
        if (item && typeof item === 'object' && 'str' in item && typeof (item as { str: string }).str === 'string') {
          acc += `${(item as { str: string }).str} `;
        }
      }
    }
    const lower = acc.toLowerCase();
    if (lower.includes('acta individual de reparto')) return true;
    if (lower.includes('acta de reparto')) return true;
    if (/acta\s+individual[^\n]{0,120}reparto/i.test(acc)) return true;
    return false;
  } catch {
    return false;
  }
}

/** true si el PDF es una acta individual / acta de reparto (CSJ / servicios administrativos). */
export async function detectActaRepartoInPdfBuffer(buf: Buffer | null | undefined): Promise<boolean> {
  if (!buf || buf.length < 100) return false;
  if (!isPdfMagic(buf)) return false;
  if (detectFromRawBytes(buf)) return true;
  return detectFromPdfJs(buf);
}

export function filenameSuggestsActaReparto(filenameLower: string): boolean {
  return (
    filenameLower.includes('acta') ||
    filenameLower.includes('reparto') ||
    filenameLower.includes('secuencia')
  );
}

/** Cuenta páginas con PDF.js legacy en Node; respaldo por /Count en bytes. */
export async function countPdfPagesInBuffer(buf: Buffer | null | undefined): Promise<number | null> {
  if (!buf || buf.length < 100 || !isPdfMagic(buf)) return null;
  try {
    const pdf = await openPdfDocument(buf);
    return pdf.numPages > 0 ? pdf.numPages : null;
  } catch {
    return estimatePdfPageCountFromBytes(buf);
  }
}

/** Texto legible de las primeras páginas (acta de reparto, autos, etc.). */
export async function extractPlainTextFromPdfBuffer(
  buf: Buffer | null | undefined,
  maxPages = 4
): Promise<string> {
  if (!buf || buf.length < 100 || !isPdfMagic(buf)) return '';
  try {
    const pdf = await openPdfDocument(buf);
    const pages = Math.min(pdf.numPages, maxPages);
    let acc = '';
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      for (const item of tc.items) {
        if (item && typeof item === 'object' && 'str' in item && typeof (item as { str: string }).str === 'string') {
          acc += `${(item as { str: string }).str} `;
        }
      }
      acc += '\n';
    }
    return acc.trim();
  } catch {
    return '';
  }
}

/** CUI solo si el texto del PDF trae un 11001… válido (no secuencias binarias espurias). */
export async function extractRadicado23FromPdfBuffer(buf: Buffer | null | undefined): Promise<string | null> {
  const plain = await extractPlainTextFromPdfBuffer(buf, 4);
  if (!plain) return null;
  return extractExplicitCuiFromText(plain);
}
