/**
 * Arma el CUI de 23 dígitos (origen en primera instancia) a partir de correos de reparto/remisión
 * desorganizados: el asunto trae «034 – 2026 – 00545» y el cuerpo el juzgado remitente (Mpal vs Circuito).
 */

export const BOGOTA_CITY_CODE = '11001';
/** Juzgado civil del circuito (Bogotá). */
export const ENTITY_CIRCUITO_CIVIL = '31';
/** Juzgado civil municipal (Bogotá). */
export const ENTITY_MUNICIPAL_CIVIL = '40';
export const SPECIALTY_CIVIL_TUTELA = '03';

export type RemittingCourtKind = 'municipal_civil' | 'circuito_civil';

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

/** Rechaza basura del PDF (ej. 17405080153851866644693) que no es CUI judicial bogotano. */
export function isPlausibleBogotaTutelaCui(digits: string): boolean {
  if (digits.length !== 23 || !digits.startsWith(BOGOTA_CITY_CODE)) return false;
  const entity = digits.slice(5, 7);
  if (entity !== ENTITY_CIRCUITO_CIVIL && entity !== ENTITY_MUNICIPAL_CIVIL) return false;
  const specialty = digits.slice(7, 9);
  if (specialty !== SPECIALTY_CIVIL_TUTELA) return false;
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

/**
 * Juzgado remitente en cadena de correo (prioriza el más específico en el hilo).
 * PCCM ≈ promiscuo/civil municipal; Mpal = municipal (entidad 40).
 */
export function detectRemittingCourt(text: string): RemittingCourtInfo | null {
  let best: RemittingCourtInfo | null = null;

  const add = (kind: RemittingCourtKind, numStr: string) => {
    const n = parseInt(numStr, 10);
    if (Number.isNaN(n) || n < 1 || n > 999) return;
    const despachoCode = String(n).padStart(3, '0');
    best = {
      kind,
      despachoCode,
      label:
        kind === 'municipal_civil'
          ? `Juzgado ${n} Civil Municipal de Bogotá`
          : `Juzgado ${n} Civil del Circuito de Bogotá`,
    };
  };

  for (const m of text.matchAll(/Juzgado\s+(\d{1,3})\s+Civil\s+Municipal/gi)) add('municipal_civil', m[1]);
  for (const m of text.matchAll(/\((\d{1,3})\)\s+CIVIL\s+MUNICIPAL/gi)) add('municipal_civil', m[1]);
  for (const m of text.matchAll(/Juzgado\s+(\d{1,3})\s+Civil\s+(?:del\s+)?Circuito/gi)) add('circuito_civil', m[1]);
  for (const m of text.matchAll(/cmpl(\d{2,3})bt@cendoj/gi)) add('municipal_civil', m[1]);
  for (const m of text.matchAll(/ccto(\d{2,3})bt@cendoj/gi)) add('circuito_civil', m[1]);

  return best;
}

export type RepartoInternalRef = {
  /** Número de juzgado / despacho en el asunto (ej. 034). */
  despachoHint: string;
  year: string;
  consecutivo: string;
  instance: string;
};

/** Asunto: «No. 034 – 2026 – 00545– 00» o «… 00545– 00». */
export function parseRepartoInternalRef(subject: string): RepartoInternalRef | null {
  const m = subject.match(
    /No\.?\s*(\d{1,3})\s*[–—\-]\s*(\d{4})\s*[–—\-]\s*(\d{4,6})\s*[–—\-]\s*(\d{2})\b/i
  );
  if (!m) return null;
  return {
    despachoHint: m[1].padStart(3, '0'),
    year: m[2],
    consecutivo: m[3].padStart(5, '0').slice(-5),
    instance: m[4].padStart(2, '0').slice(-2),
  };
}

export function buildOriginCuiFromReparto(
  ref: RepartoInternalRef,
  court: RemittingCourtInfo
): string {
  const entity = court.kind === 'municipal_civil' ? ENTITY_MUNICIPAL_CIVIL : ENTITY_CIRCUITO_CIVIL;
  const despacho = court.despachoCode || ref.despachoHint;
  return (
    `${BOGOTA_CITY_CODE}${entity}${SPECIALTY_CIVIL_TUTELA}${despacho}` +
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
  const court = detectRemittingCourt(combined);
  if (ref && court) {
    const built = buildOriginCuiFromReparto(ref, court);
    if (isPlausibleBogotaTutelaCui(built)) {
      return { originRadicado: built, originCourt: court.label, source: 'built' };
    }
  }

  return { originRadicado: null, originCourt: court?.label ?? null, source: null };
}
