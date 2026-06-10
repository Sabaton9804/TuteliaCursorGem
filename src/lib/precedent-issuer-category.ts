/**
 * Categoría de la corporación que profirió el acto (nivel / tipo de órgano).
 * La tutela es transversal: lo que distingue precedentes de referencia suele ser esta categoría
 * (Corte Constitucional, Corte Suprema, Tribunal, Juzgado, etc.).
 */

export const ISSUER_CATEGORY_CODES = [
  'corte_constitucional',
  'corte_suprema',
  'consejo_estado',
  'tribunal',
  'juzgado',
  'juzgado_pequenas_causas',
  'comision',
  'otro',
] as const;

export type IssuerCategoryCode = (typeof ISSUER_CATEGORY_CODES)[number];

export const ISSUER_CATEGORY_LABELS: Record<IssuerCategoryCode, string> = {
  corte_constitucional: 'Corte Constitucional',
  corte_suprema: 'Corte Suprema de Justicia',
  consejo_estado: 'Consejo de Estado',
  tribunal: 'Tribunal Superior / Tribunal',
  juzgado: 'Juzgado',
  juzgado_pequenas_causas: 'Juzgado de pequeñas causas',
  comision: 'Comisión / Sala especial',
  otro: 'Otra corporación',
};

const ALIAS_TO_CODE: Record<string, IssuerCategoryCode> = {
  corte_constitucional: 'corte_constitucional',
  constitucional: 'corte_constitucional',
  corte_suprema: 'corte_suprema',
  suprema: 'corte_suprema',
  csj: 'corte_suprema',
  consejo_estado: 'consejo_estado',
  consejo: 'consejo_estado',
  tribunal: 'tribunal',
  tribunal_superior: 'tribunal',
  juzgado: 'juzgado',
  juzgado_circuito: 'juzgado',
  juzgado_municipal: 'juzgado',
  pequenas_causas: 'juzgado_pequenas_causas',
  comision: 'comision',
  sala_especial: 'comision',
  otro: 'otro',
};

function normalizeKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function normalizeIssuerCategory(raw: string | null | undefined): IssuerCategoryCode | null {
  const n = normalizeKey(String(raw || ''));
  if (!n) return null;
  if ((ISSUER_CATEGORY_CODES as readonly string[]).includes(n)) return n as IssuerCategoryCode;
  for (const [alias, code] of Object.entries(ALIAS_TO_CODE)) {
    if (n === alias || n.includes(alias)) return code;
  }
  return null;
}

/** Infiere categoría desde el nombre de corporación (source_corporation). */
export function inferIssuerCategoryFromCorporation(corporation: string): IssuerCategoryCode | null {
  const n = normalizeKey(corporation).replace(/_/g, ' ');
  if (!n) return null;
  if (/corte\s+constitucional/.test(n) || /\bt\s*\d/.test(n)) return 'corte_constitucional';
  if (/corte\s+suprema/.test(n) || /sala\s+(civil|laboral|penal)\s+de\s+la\s+corte/.test(n)) {
    return 'corte_suprema';
  }
  if (/consejo\s+de\s+estado/.test(n)) return 'consejo_estado';
  if (/corte\s+interamericana/.test(n)) return 'comision';
  if (/pequenas\s+causas/.test(n)) return 'juzgado_pequenas_causas';
  if (/tribunal/.test(n)) return 'tribunal';
  if (/juzgado/.test(n) || /magistrado\s+promiscuo/.test(n)) return 'juzgado';
  if (/comision|sala\s+de\s+casacion/.test(n)) return 'comision';
  return null;
}

export function issuerCategoryLabel(code: string | null | undefined): string {
  const c = normalizeIssuerCategory(code);
  return c ? ISSUER_CATEGORY_LABELS[c] : 'Sin categoría';
}
