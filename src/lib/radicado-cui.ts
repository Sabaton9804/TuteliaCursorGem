/**
 * CUI nacional (Ac. 201/1997 CSJ): 23 dígitos; los 2 finales identifican instancia/recurso.
 * Un mismo proceso conserva los 21 primeros; cambia el sufijo (00 primera, 01+ segunda y vueltas).
 */

export const CUI_INSTANCE_PRIMERA = '00';
/** Primera llegada a segunda instancia (sufijo mínimo tras origen 00). */
export const CUI_INSTANCE_SEGUNDA = '01';

export type RadicadoCourtPrefix = {
  cityCode: string;
  entityCode: string;
  specialtyCode: string;
  despachoCode: string;
  instanceCode?: string;
};

export function cuiBase21(radicadoRaw: string): string | null {
  const digits = radicadoRaw.replace(/\D/g, '');
  if (digits.length !== 23) return null;
  return digits.slice(0, 21);
}

/** Siguiente sufijo de 2 dígitos (01, 02…) según origen y radicados ya usados con la misma base. */
export function nextSegundaInstanciaSuffix(
  originRadicadoRaw: string,
  existingRadicados: string[]
): string | null {
  const digits = originRadicadoRaw.replace(/\D/g, '');
  if (digits.length !== 23) return null;
  const base = digits.slice(0, 21);
  const originSuffix = parseInt(digits.slice(21, 23), 10);
  let maxSuffix = Number.isNaN(originSuffix) ? 0 : originSuffix;

  for (const raw of existingRadicados) {
    const d = raw.replace(/\D/g, '');
    if (d.length !== 23 || d.slice(0, 21) !== base) continue;
    const n = parseInt(d.slice(21, 23), 10);
    if (!Number.isNaN(n) && n > maxSuffix) maxSuffix = n;
  }

  const next = maxSuffix + 1;
  if (next > 99) return null;
  return String(next).padStart(2, '0');
}

/** Radicado nuevo de primera instancia en el despacho (consecutivo del año). */
export function buildRadicadoPrimeraInstancia(
  consecutiveRaw: string,
  court: RadicadoCourtPrefix,
  year = new Date().getFullYear()
): string {
  const cons = consecutiveRaw.replace(/\D/g, '').padStart(5, '0').slice(-5);
  const instance = court.instanceCode ?? CUI_INSTANCE_PRIMERA;
  return (
    `${court.cityCode}${court.entityCode}${court.specialtyCode}${court.despachoCode}` +
    `${String(year)}${cons}${instance}`
  );
}

/**
 * Segunda instancia (o vuelta tras nulidad): mismos 21 dígitos + siguiente sufijo disponible.
 * Ej.: origen …73000 y ya existe …73001 → propone …73002.
 */
export function deriveRadicadoSegundaInstancia(
  originRadicadoRaw: string,
  existingRadicados: string[] = []
): string | null {
  const base = cuiBase21(originRadicadoRaw);
  if (!base) return null;
  const suffix = nextSegundaInstanciaSuffix(originRadicadoRaw, existingRadicados);
  if (!suffix) return null;
  return `${base}${suffix}`;
}

export function normalizeRadicadoDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Mismo CUI (21 dígitos): solo cambia el sufijo de instancia (00 vs 01…). */
export function radicadosCompartenMismoCui(a: string, b: string): boolean {
  const da = normalizeRadicadoDigits(a);
  const db = normalizeRadicadoDigits(b);
  if (da.length !== 23 || db.length !== 23) return false;
  return da.slice(0, 21) === db.slice(0, 21);
}
