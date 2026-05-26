import type { CaseAppellant, CaseOriginRuling } from '../types';

export type SegundaFieldsExtract = {
  appellant: CaseAppellant | null;
  originRuling: CaseOriginRuling | null;
  sources: string[];
};

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Sentido del fallo de tutela en primera instancia (heurística sobre texto). */
export function extractOriginRulingFromText(text: string): CaseOriginRuling | null {
  const t = norm(text);
  if (!t.trim()) return null;

  const negPatterns = [
    /\bneg[oó]\s+(?:la\s+)?tutela\b/,
    /\bdeneg[oó]\b/,
    /\bniega(?:n)?\s+(?:la\s+)?(?:tutela|solicitud|pretensi[oó]n)/,
    /\bno\s+conced(?:e|i[oó])\b/,
    /\bdeclara(?:\s+)?(?:improcedente|infundad)/,
    /\brechaza(?:\s+)?(?:la\s+)?(?:tutela|solicitud)/,
    /\binadmit/,
    /\bsin\s+amparo\b/,
    /\bno\s+ampar/,
  ];
  const posPatterns = [
    /\bconced(?:e|i[oó])\s+(?:la\s+)?tutela\b/,
    /\bconced(?:e|i[oó])\s+(?:el\s+)?amparo\b/,
    /\bampar(?:a|ó)\s+(?:los\s+)?derechos\b/,
    /\btutel(?:a|ar)\s+(?:los\s+)?derechos\b/,
    /\bconcede\s+parcialmente\b/,
    /\bconcede\s+el\s+amparo\b/,
  ];

  let neg = 0;
  let pos = 0;
  for (const re of negPatterns) if (re.test(t)) neg += 1;
  for (const re of posPatterns) if (re.test(t)) pos += 1;

  if (neg > 0 && pos === 0) return 'nego';
  if (pos > 0 && neg === 0) return 'concedio';
  if (pos > neg) return 'concedio';
  if (neg > pos) return 'nego';
  return null;
}

/** Quién impugna (accionante o accionado). */
export function extractAppellantFromText(text: string): CaseAppellant | null {
  const t = norm(text);
  if (!t.trim()) return null;

  if (
    /\b(?:el\s+)?accionante\s+impugn/i.test(t) ||
    /\bimpugnaci[oó]n\s+(?:presentada\s+)?(?:por\s+)?(?:el\s+)?accionante\b/i.test(t) ||
    /\bpor\s+parte\s+del\s+accionante\b/i.test(t) &&
      /\bimpugn/i.test(t)
  ) {
    return 'accionante';
  }
  if (
    /\b(?:el\s+)?accionad[oa]\s+impugn/i.test(t) ||
    /\bimpugnaci[oó]n\s+(?:presentada\s+)?(?:por\s+)?(?:el\s+)?accionad[oa]\b/i.test(t) ||
    /\bpor\s+parte\s+del\s+accionad[oa]\b/i.test(t) &&
      /\bimpugn/i.test(t)
  ) {
    return 'accionado';
  }
  if (/\bimpugnante[:\s]+accionante\b/i.test(t)) return 'accionante';
  if (/\bimpugnante[:\s]+accionad[oa]\b/i.test(t)) return 'accionado';
  return null;
}

export function mergeSegundaFieldsExtract(
  ...partials: Array<Partial<SegundaFieldsExtract> & { sources?: string[] }>
): SegundaFieldsExtract {
  let appellant: CaseAppellant | null = null;
  let originRuling: CaseOriginRuling | null = null;
  const sources: string[] = [];

  for (const p of partials) {
    if (p.appellant) appellant = p.appellant;
    if (p.originRuling) originRuling = p.originRuling;
    if (p.sources?.length) sources.push(...p.sources);
  }
  return { appellant, originRuling, sources: [...new Set(sources)] };
}

export function extractSegundaFieldsFromText(
  text: string,
  sourceLabel: string
): SegundaFieldsExtract {
  const appellant = extractAppellantFromText(text);
  const originRuling = extractOriginRulingFromText(text);
  const sources: string[] = [];
  if (appellant || originRuling) sources.push(sourceLabel);
  return { appellant, originRuling, sources };
}
