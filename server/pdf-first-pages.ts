import { PDFDocument } from 'pdf-lib';

/** Páginas del inicio del escrito enviadas a la IA en radicación (partes, hechos, pretensiones). */
export const LEGAL_ANALYSIS_MAX_PAGES = 25;

export type PdfFirstPagesResult = {
  base64: string;
  totalPages: number;
  usedPages: number;
  truncated: boolean;
};

/**
 * Recorta un PDF a las primeras N páginas para caber en el contexto de la IA.
 * En demandas largas (100–200+ hojas) la cabecera y el libelo suelen bastar para tipificar y partes.
 */
export async function slicePdfBase64FirstPages(
  pdfBase64: string,
  maxPages = LEGAL_ANALYSIS_MAX_PAGES
): Promise<PdfFirstPagesResult> {
  const raw = String(pdfBase64 || '').replace(/^data:application\/pdf;base64,/i, '');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length < 100) {
    return { base64: raw, totalPages: 0, usedPages: 0, truncated: false };
  }
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  if (totalPages <= 0) {
    return { base64: raw, totalPages: 0, usedPages: 0, truncated: false };
  }
  const usedPages = Math.min(totalPages, Math.max(1, maxPages));
  if (usedPages >= totalPages) {
    return { base64: raw, totalPages, usedPages: totalPages, truncated: false };
  }
  const out = await PDFDocument.create();
  const indices = Array.from({ length: usedPages }, (_, i) => i);
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  const outBytes = await out.save({ useObjectStreams: false });
  return {
    base64: Buffer.from(outBytes).toString('base64'),
    totalPages,
    usedPages,
    truncated: true,
  };
}
