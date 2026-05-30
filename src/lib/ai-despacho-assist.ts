/** Aviso legal fijo en asistencia IA de redacción (Acuerdo PCSJA24-12243). */
export const DESPACHO_AI_DISCLAIMER =
  'Asistencia limitada. No redacta fallos ni sustituye la decisión del despacho. Uso informativo conforme al Acuerdo PCSJA24-12243.';

export const AI_REVIEW_MAX_CHARS = 28_000;

export type TextReviewIssueKind = 'ortografia' | 'gramatica' | 'estilo' | 'puntuacion';

export type TextReviewIssue = {
  kind: TextReviewIssueKind;
  excerpt: string;
  suggestion: string;
  note: string;
};

export type TextReviewResult = {
  summary: string;
  correctedText: string;
  issues: TextReviewIssue[];
};
