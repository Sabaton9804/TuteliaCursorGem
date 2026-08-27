import type { Document } from '../types';
import { isCaseDocumentDocx, isCaseDocumentPdf } from './expediente-docx';

/** Versión del prompt; al cambiar, invalida caché en servidor. */
export const PIECE_AI_PROMPT_VERSION = 'v2.2';

export const PIECE_AI_MAX_PAGES = 40;

export const PIECE_AI_DISCLAIMER =
  'Herramienta de apoyo orientativa bajo el Acuerdo PCSJA24-12243. No reemplaza la lectura obligatoria de la pieza procesal ni constituye decisión judicial.';

/** Lectura rápida genérica (tutela y piezas no-auto). */
export type PieceAiGeneralAnalysisData = {
  schema: 'general_v1';
  document_type: string;
  purpose: string;
  critical_dates: PieceAiCriticalDate[];
  key_points: string[];
  utility_note: string;
};

export type PieceAiCriticalDate = {
  date: string;
  description: string;
};

export type PieceAiCgpAutoBusinessTerm = {
  applies: boolean;
  days: number;
  count_from: string;
  legal_basis: string;
  deadline_hint: string;
  stage_note: string;
};

export type PieceAiCgpAutoPlannerDue = {
  title: string;
  due_note: string;
  responsible: string;
  priority: string;
};

export type PieceAiCgpAutoSubsequentAction = {
  order: number;
  action: string;
  responsible: string;
};

/** Lectura operativa para autos civiles CGP (secretaría J51). */
export type PieceAiCgpAutoAnalysisData = {
  schema: 'cgp_auto_v2';
  document_type: string;
  resolutive_summary: string;
  legal_grounds: string[];
  business_term: PieceAiCgpAutoBusinessTerm;
  planner_due: PieceAiCgpAutoPlannerDue;
  subsequent_actions: PieceAiCgpAutoSubsequentAction[];
  informe_j51_draft: string;
  cautions: string[];
  ocr_quality_note: string;
};

export type PieceAiAnalysisData = PieceAiGeneralAnalysisData | PieceAiCgpAutoAnalysisData;

export function isPieceAiCgpAutoAnalysis(data: PieceAiAnalysisData): data is PieceAiCgpAutoAnalysisData {
  return data.schema === 'cgp_auto_v2';
}

export type PieceAiAnalysisResponse = {
  cached: boolean;
  contentHash: string;
  pageCountSent: number;
  analysisData: PieceAiAnalysisData;
  summaryMarkdown: string;
  analyzedAt?: string;
};

export function isLikelyCivilCgpAutoPiece(pieceName: string, systemType?: string | null): boolean {
  const name = pieceName.trim();
  const type = String(systemType ?? '').trim().toLowerCase();
  if (/^auto/i.test(name) || /^providencia/i.test(name) || /^sentencia/i.test(name)) return true;
  if (/inadmisi|admisi|rechazo|subsana|emplaza|decreta|ordena|requiere|avoca|niega/i.test(name)) return true;
  if (type.includes('auto') || type.includes('providencia') || type.includes('sentencia')) return true;
  return false;
}

export function isCivilCaseForPieceAi(caseType: string | null | undefined, catalogTipoRegistro?: string | null): boolean {
  if (String(caseType ?? '').startsWith('civil_')) return true;
  return catalogTipoRegistro === 'civil';
}

function buildCgpAutoSummaryMarkdown(data: PieceAiCgpAutoAnalysisData): string {
  const lines: string[] = [];
  lines.push(`### ${data.document_type.trim() || 'Auto / providencia'}`);
  lines.push('');
  lines.push('**Resolución (parte resolutiva)**');
  lines.push(data.resolutive_summary.trim() || '—');
  lines.push('');
  if (data.legal_grounds.length > 0) {
    lines.push('**Fundamentos normativos citados**');
    for (const g of data.legal_grounds) lines.push(`- ${g.trim()}`);
    lines.push('');
  }
  const term = data.business_term;
  lines.push('**Término procesal (días hábiles — CGP art. 118)**');
  if (term.applies && term.days > 0) {
    lines.push(
      `- **Plazo:** ${term.days} día(s) hábil(es) — ${term.count_from.trim() || 'inicio no precisado en el auto'}`,
    );
    lines.push(`- **Base legal del plazo:** ${term.legal_basis.trim() || '—'}`);
    lines.push(`- **Fecha / cómputo operativo:** ${term.deadline_hint.trim() || '—'}`);
    lines.push(`- **Estado tras el auto:** ${term.stage_note.trim() || '—'}`);
  } else {
    lines.push(term.stage_note.trim() || 'Sin término perentorio identificado en el auto.');
  }
  lines.push('');
  const planner = data.planner_due;
  lines.push('**Acción Planner / Due (prioritaria)**');
  lines.push(`- **Título:** ${planner.title.trim() || '—'}`);
  lines.push(`- **Vencimiento / seguimiento:** ${planner.due_note.trim() || '—'}`);
  lines.push(`- **Responsable:** ${planner.responsible.trim() || 'secretaría'}`);
  lines.push(`- **Prioridad:** ${planner.priority.trim() || 'media'}`);
  lines.push('');
  if (data.subsequent_actions.length > 0) {
    lines.push('**Actuaciones posteriores al auto (orden sugerido)**');
    const sorted = [...data.subsequent_actions].sort((a, b) => a.order - b.order);
    for (const step of sorted) {
      lines.push(`${step.order}. ${step.action.trim()} — *${step.responsible.trim() || 'secretaría'}*`);
    }
    lines.push('');
  }
  lines.push('**Borrador informe de ingreso**');
  lines.push(data.informe_j51_draft.trim() || '—');
  lines.push('');
  if (data.cautions.length > 0) {
    lines.push('**Advertencias**');
    for (const c of data.cautions) lines.push(`- ${c.trim()}`);
    lines.push('');
  }
  if (data.ocr_quality_note.trim()) {
    lines.push('**Calidad del texto**');
    lines.push(data.ocr_quality_note.trim());
  }
  return lines.join('\n').trim();
}

function buildGeneralSummaryMarkdown(data: PieceAiGeneralAnalysisData): string {
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

export function buildPieceAiSummaryMarkdown(data: PieceAiAnalysisData): string {
  if (isPieceAiCgpAutoAnalysis(data)) return buildCgpAutoSummaryMarkdown(data);
  return buildGeneralSummaryMarkdown(data);
}

export type PieceAiEligibility = { allowed: boolean; reason?: string };

/** Reglas de UI (el servidor vuelve a validar). */
export function pieceAiEligibility(
  doc: Document,
  pdfPageCount: number | null | undefined,
): PieceAiEligibility {
  if (doc.ingestError && !doc.storagePath?.trim()) {
    return { allowed: false, reason: 'La pieza no se cargó correctamente; no hay archivo para analizar.' };
  }
  if (!doc.storagePath?.trim() && !(doc.content && doc.content.length > 0) && !doc.sgdeId?.trim()) {
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
