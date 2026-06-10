/**
 * Especialidad / materia del proceso para la biblioteca de precedentes.
 * Alineado con judicial_specialties y ampliado (tutela, agrario, etc.).
 */

export const LEGAL_SPECIALTY_CODES = [
  'tutela',
  'civil',
  'laboral',
  'familia',
  'penal',
  'administrativo',
  'agrario',
  'constitucional',
  'contencioso',
  'comercial',
  'mixto',
  'otro',
] as const;

export type LegalSpecialtyCode = (typeof LEGAL_SPECIALTY_CODES)[number];

export const LEGAL_SPECIALTY_LABELS: Record<LegalSpecialtyCode, string> = {
  tutela: 'Tutela / acción constitucional',
  civil: 'Civil',
  laboral: 'Laboral',
  familia: 'Familia',
  penal: 'Penal',
  administrativo: 'Administrativo',
  agrario: 'Agrario / tierras',
  constitucional: 'Constitucional',
  contencioso: 'Contencioso administrativo',
  comercial: 'Comercial',
  mixto: 'Mixto / varias materias',
  otro: 'Otra / sin clasificar',
};

/** Códigos de especialidad en posiciones 8-9 del CUI (23 dígitos), según uso habitual CSJ. */
const CUI_SPECIALTY_DIGITS: Record<string, LegalSpecialtyCode> = {
  '03': 'civil',
  '04': 'penal',
  '05': 'laboral',
  '06': 'familia',
  '07': 'administrativo',
  '08': 'contencioso',
  '40': 'agrario',
  '41': 'agrario',
};

const ALIAS_TO_CODE: Record<string, LegalSpecialtyCode> = {
  tutela: 'tutela',
  accion: 'tutela',
  constitucional: 'constitucional',
  civil: 'civil',
  laboral: 'laboral',
  trabajo: 'laboral',
  familia: 'familia',
  penal: 'penal',
  administrativo: 'administrativo',
  agrario: 'agrario',
  tierras: 'agrario',
  restitucion: 'agrario',
  contencioso: 'contencioso',
  comercial: 'comercial',
  mercantil: 'comercial',
  mixto: 'mixto',
  otro: 'otro',
};

export function normalizeLegalSpecialty(raw: string | null | undefined): LegalSpecialtyCode | null {
  const n = String(raw || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!n) return null;
  if ((LEGAL_SPECIALTY_CODES as readonly string[]).includes(n)) return n as LegalSpecialtyCode;
  for (const [alias, code] of Object.entries(ALIAS_TO_CODE)) {
    if (n === alias || n.includes(alias)) return code;
  }
  return null;
}

/** Referencias T- / SU- o dígitos 8-9 del CUI. */
export function inferLegalSpecialtyFromRadicado(radicado: string): LegalSpecialtyCode | null {
  const r = String(radicado || '').trim();
  if (/^T[\s\-]?\d/i.test(r) || /^SU[\s\-]?\d/i.test(r)) return 'tutela';
  const digits = r.replace(/\D/g, '');
  if (digits.length === 23) {
    const spec = digits.slice(7, 9);
    return CUI_SPECIALTY_DIGITS[spec] ?? null;
  }
  return null;
}

export function legalSpecialtyLabel(code: string | null | undefined): string {
  const c = normalizeLegalSpecialty(code);
  return c ? LEGAL_SPECIALTY_LABELS[c] : 'Sin especialidad';
}
