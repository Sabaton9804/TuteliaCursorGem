import type { Document } from '../types';
import { isCaseDocumentDocx, isCaseDocumentPdf } from './expediente-docx';

/** Versión del prompt; al cambiar, invalida caché en servidor. */
export const PIECE_AI_PROMPT_VERSION = 'v1.0';

export const PIECE_AI_MAX_PAGES = 40;

export const PIECE_AI_DISCLAIMER =
  'Herramienta de apoyo orientativa bajo el Acuerdo PCSJA24-12243. No reemplaza la lectura obligatoria de la pieza procesal ni constituye decisión judicial.';

export type PieceAiCriticalDate = {
  date: string;
  description: string;
};

export type PieceAiAnalysisData = {
  document_type: string;
  purpose: string;
  critical_dates: PieceAiCriticalDate[];
  key_points: string[];
  utility_note: string;
};

export type PieceAiAnalysisResponse = {
  cached: boolean;
  contentHash: string;
  pageCountSent: number;
  analysisData: PieceAiAnalysisData;
  summaryMarkdown: string;
  analyzedAt?: string;
};

export function buildPieceAiSummaryMarkdown(data: PieceAiAnalysisData): string {
  const lines: string[] = [];
  lines.push(`### ${data.document_type.trim() || 'Pieza procesal'}`);
  lines.push('');
  lines.push('**Propósito / qué aporta o pide**');
  lines.push(data.purpose.trim() || '—');
  lines.push('');
  if (data.critical_dates.length > 0) {
    lines.push('**Fechas y plazos citados en esta pieza**');
    for (const d of data.critical_dates) {
      lines.push(`- **${d.date.trim() || '—'}:** ${d.description.trim()}`);
    }
    lines.push('');
  }
  if (data.key_points.length > 0) {
    lines.push('**Puntos clave**');
    for (const p of data.key_points) {
      lines.push(`- ${p.trim()}`);
    }
    lines.push('');
  }
  lines.push('**Nota para el sustanciador**');
  lines.push(data.utility_note.trim() || '—');
  return lines.join('\n').trim();
}

export type PieceAiEligibility = { allowed: boolean; reason?: string };

/** Reglas de UI (el servidor vuelve a validar). */
export function pieceAiEligibility(
  doc: Document,
  pdfPageCount: number | null | undefined
): PieceAiEligibility {
  if (doc.ingestError && !doc.storagePath?.trim()) {
    return { allowed: false, reason: 'La pieza no se cargó correctamente; no hay archivo para analizar.' };
  }
  if (!doc.storagePath?.trim() && !(doc.content && doc.content.length > 0)) {
    return { allowed: false, reason: 'Sin archivo en Storage para analizar.' };
  }
  const pdf = isCaseDocumentPdf(doc);
  const docx = isCaseDocumentDocx(doc);
  if (!pdf && !docx) {
    return {
      allowed: false,
      reason: 'Solo PDF o Word (.docx). Imágenes, audio y otros formatos no están soportados.',
    };
  }
  if (pdf && pdfPageCount != null && pdfPageCount > PIECE_AI_MAX_PAGES) {
    return {
      allowed: false,
      reason: `El documento tiene ${pdfPageCount} páginas (máximo ${PIECE_AI_MAX_PAGES} para lectura rápida). Revise por secciones o use la síntesis del expediente.`,
    };
  }
  return { allowed: true };
}
