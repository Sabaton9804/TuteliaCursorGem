/**
 * Arma el CUI de 23 dígitos (origen en primera instancia) a partir de correos de reparto/remisión
 * desorganizados: el asunto trae «034 – 2026 – 00545» o «090-2026-01382» y el cuerpo el juzgado remitente
 * (municipal, circuito o Pequeñas Causas).
 */

export const BOGOTA_CITY_CODE = '11001';
/** Juzgado civil del circuito (Bogotá). */
export const ENTITY_CIRCUITO_CIVIL = '31';
/** Juzgado civil municipal (Bogotá). */
export const ENTITY_MUNICIPAL_CIVIL = '40';
/** Juzgado de Pequeñas Causas y Competencia Múltiple (Bogotá). */
export const ENTITY_PEQUENAS_CAUSAS = '41';
export const SPECIALTY_CIVIL_TUTELA = '03';
/** Especialidad CUI de Pequeñas Causas / Competencia Múltiple (tutelas y demás). */
export const SPECIALTY_PEQUENAS_CAUSAS = '89';

export type RemittingCourtKind = 'municipal_civil' | 'circuito_civil' | 'pequenas_causas';

export type RemittingCourtInfo = {
  kind: RemittingCourtKind;
  /** Código despacho 3 dígitos (ej. 034). */
  despachoCode: string;
  label: string;
};

export function normalizeCui23(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  return d.length === 23 ? d : null;
}

function entitySpecialtyForKind(kind: RemittingCourtKind): { entity: string; specialty: string } {
  if (kind === 'pequenas_causas') {
    return { entity: ENTITY_PEQUENAS_CAUSAS, specialty: SPECIALTY_PEQUENAS_CAUSAS };
  }
  if (kind === 'municipal_civil') {
    return { entity: ENTITY_MUNICIPAL_CIVIL, specialty: SPECIALTY_CIVIL_TUTELA };
  }
  return { entity: ENTITY_CIRCUITO_CIVIL, specialty: SPECIALTY_CIVIL_TUTELA };
}

function labelForCourt(kind: RemittingCourtKind, n: number): string {
  if (kind === 'pequenas_causas') {
    return `Juzgado ${n} de Pequeñas Causas y Competencia Múltiple de Bogotá`;
  }
  if (kind === 'municipal_civil') {
    return `Juzgado ${n} Civil Municipal de Bogotá`;
  }
  return `Juzgado ${n} Civil del Circuito de Bogotá`;
}

/** Rechaza basura del PDF (ej. 17405080153851866644693) que no es CUI judicial bogotano. */
export function isPlausibleBogotaTutelaCui(digits: string): boolean {
  if (digits.length !== 23 || !digits.startsWith(BOGOTA_CITY_CODE)) return false;
  const entity = digits.slice(5, 7);
  const specialty = digits.slice(7, 9);
  const civilTutela =
    (entity === ENTITY_CIRCUITO_CIVIL || entity === ENTITY_MUNICIPAL_CIVIL) &&
    specialty === SPECIALTY_CIVIL_TUTELA;
  const pccm = entity === ENTITY_PEQUENAS_CAUSAS && specialty === SPECIALTY_PEQUENAS_CAUSAS;
  if (!civilTutela && !pccm) return false;
  const year = parseInt(digits.slice(12, 16), 10);
  if (year < 1998 || year > 2100) return false;
  return true;
}

/** «110014003034 – 2026 – 00545– 00» o línea ACCIÓN DE TUTELA. */
export function extractExplicitCuiFromText(text: string): string | null {
  const accion = text.match(/ACCI[ÓO]N\s+DE\s+TUTELA\s*:\s*([\d\s–—\-]+)/i);
  if (accion) {
    const d = normalizeCui23(accion[1]);
    if (d && isPlausibleBogotaTutelaCui(d)) return d;
  }
  for (const m of text.matchAll(/11001[\d\s–—\-]{12,40}/g)) {
    const d = normalizeCui23(m[0]);
    if (d && isPlausibleBogotaTutelaCui(d)) return d;
  }
  const all = [...text.matchAll(/\b(\d{23})\b/g)].map((x) => x[1]);
  for (const d of all) {
    if (isPlausibleBogotaTutelaCui(d)) return d;
  }
  return null;
}

function courtScore(c: RemittingCourtInfo, preferredDespachoCode?: string | null): number {
  let score = 0;
  const preferred = preferredDespachoCode?.replace(/\D/g, '').padStart(3, '0').slice(-3);
  if (preferred && c.despachoCode === preferred) score += 100;
  if (c.kind === 'pequenas_causas') score += 20;
  else if (c.kind === 'municipal_civil') score += 10;
  return score;
}

/**
 * Juzgado remitente en cadena de correo.
 * Si hay varios (hilo con el superior), prioriza el que coincida con el despacho del asunto
 * y Pequeñas Causas / municipal sobre circuito.
 */
export function detectRemittingCourt(
  text: string,
  opts?: { preferredDespachoCode?: string | null }
): RemittingCourtInfo | null {
  const candidates: RemittingCourtInfo[] = [];
  const seen = new Set<string>();

  const add = (kind: RemittingCourtKind, numStr: string) => {
    const n = parseInt(numStr, 10);
    if (Number.isNaN(n) || n < 1 || n > 999) return;
    const despachoCode = String(n).padStart(3, '0');
    const key = `${kind}:${despachoCode}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      kind,
      despachoCode,
      label: labelForCourt(kind, n),
    });
  };

  for (const m of text.matchAll(/Juzgado\s+(\d{1,3})\s+(?:de\s+)?Peque[nñ]as\s+Causas/gi)) {
    add('pequenas_causas', m[1]);
  }
  for (const m of text.matchAll(/JUZGADO\s+(\d{1,3})\s+DE\s+PEQUE[NÑ]AS\s+CAUSAS/gi)) {
    add('pequenas_causas', m[1]);
  }
  for (const m of text.matchAll(/j(\d{1,3})pqccm[a-z]*@cendoj/gi)) {
    add('pequenas_causas', m[1]);
  }

  for (const m of text.matchAll(/Juzgado\s+(\d{1,3})\s+Civil\s+Municipal/gi)) {
    add('municipal_civil', m[1]);
  }
  for (const m of text.matchAll(/\((\d{1,3})\)\s+CIVIL\s+MUNICIPAL/gi)) {
    add('municipal_civil', m[1]);
  }
  for (const m of text.matchAll(/cmpl(\d{2,3})bt@cendoj/gi)) {
    add('municipal_civil', m[1]);
  }

  for (const m of text.matchAll(/Juzgado\s+(\d{1,3})\s+Civil\s+(?:del\s+)?Circuito/gi)) {
    add('circuito_civil', m[1]);
  }
  for (const m of text.matchAll(/ccto(\d{2,3})bt@cendoj/gi)) {
    add('circuito_civil', m[1]);
  }

  if (!candidates.length) return null;
  candidates.sort(
    (a, b) => courtScore(b, opts?.preferredDespachoCode) - courtScore(a, opts?.preferredDespachoCode)
  );
  return candidates[0];
}

export type RepartoInternalRef = {
  /** Número de juzgado / despacho en el asunto (ej. 034). */
  despachoHint: string;
  year: string;
  consecutivo: string;
  instance: string;
};

/**
 * Asunto: «No. 034 – 2026 – 00545– 00» o forma corta «090-2026-01382»
 * (instancia opcional; por defecto 00).
 */
export function parseRepartoInternalRef(subject: string): RepartoInternalRef | null {
  const withInstance = subject.match(
    /No\.?\s*(\d{1,3})\s*[–—\-]\s*(\d{4})\s*[–—\-]\s*(\d{4,6})\s*[–—\-]\s*(\d{2})\b/i
  );
  if (withInstance) {
    return {
      despachoHint: withInstance[1].padStart(3, '0'),
      year: withInstance[2],
      consecutivo: withInstance[3].padStart(5, '0').slice(-5),
      instance: withInstance[4].padStart(2, '0').slice(-2),
    };
  }

  const short = subject.match(
    /\b(\d{1,3})\s*[–—\-]\s*((?:19|20)\d{2})\s*[–—\-]\s*(\d{4,5})(?:\s*[–—\-]\s*(\d{2}))?\b/
  );
  if (short) {
    return {
      despachoHint: short[1].padStart(3, '0'),
      year: short[2],
      consecutivo: short[3].padStart(5, '0').slice(-5),
      instance: (short[4] || '00').padStart(2, '0').slice(-2),
    };
  }

  return null;
}

export function buildOriginCuiFromReparto(
  ref: RepartoInternalRef,
  court: RemittingCourtInfo
): string {
  const { entity, specialty } = entitySpecialtyForKind(court.kind);
  const despacho = court.despachoCode || ref.despachoHint;
  return (
    `${BOGOTA_CITY_CODE}${entity}${specialty}${despacho}` +
    `${ref.year}${ref.consecutivo}${ref.instance}`
  );
}

/**
 * Resuelve CUI de origen: primero explícito en el correo; si no, asunto + juzgado remitente.
 */
export function resolveOriginRadicadoFromRepartoEmail(subject: string, bodyText: string): {
  originRadicado: string | null;
  originCourt: string | null;
  source: 'explicit' | 'built' | null;
} {
  const combined = `${subject}\n${bodyText}`;
  const explicit = extractExplicitCuiFromText(combined);
  if (explicit) {
    const court = detectRemittingCourt(combined);
    return {
      originRadicado: explicit,
      originCourt: court?.label ?? null,
      source: 'explicit',
    };
  }

  const ref = parseRepartoInternalRef(subject) ?? parseRepartoInternalRef(bodyText);
  const court = detectRemittingCourt(combined, {
    preferredDespachoCode: ref?.despachoHint ?? null,
  });
  if (ref && court) {
    const built = buildOriginCuiFromReparto(ref, court);
    if (isPlausibleBogotaTutelaCui(built)) {
      return { originRadicado: built, originCourt: court.label, source: 'built' };
    }
  }

  return { originRadicado: null, originCourt: court?.label ?? null, source: null };
}
