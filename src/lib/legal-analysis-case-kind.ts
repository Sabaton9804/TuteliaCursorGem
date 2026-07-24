/** Buckets de `/api/ai/legal-analysis` (prompt en servidor). */
export type LegalAnalysisCaseKind = 'civil' | 'tutela' | 'impugnacion' | 'consulta';

/**
 * Mapea case_type Jurion → kind del endpoint.
 * - civil_* → civil (hoja 2)
 * - tutela_primera → tutela (hoja 8)
 * - tutela_segunda → impugnacion (hoja 13)
 * - consulta_desacato → consulta (hoja 15)
 */
export function mapTuteliaCaseTypeToLegalAnalysisKind(
  caseType: string | null | undefined,
): LegalAnalysisCaseKind {
  const t = String(caseType || '').trim();
  if (t.startsWith('civil_')) return 'civil';
  if (t === 'tutela_segunda') return 'impugnacion';
  if (t === 'consulta_desacato') return 'consulta';
  return 'tutela';
}
