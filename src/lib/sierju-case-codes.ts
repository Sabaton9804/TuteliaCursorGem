/**
 * Códigos alineados a la hoja SIERJU «Movimiento de Tutelas» y tipos de decisión para estadística.
 *
 * Alcance completo del Excel (inventarios, entradas/salidas detalladas, acumulados) queda para cuando el flujo
 * avance más allá de admisión; conservar `derecho_tutelado_code`, `decision_type` y eventos en `case_actions`
 * con fecha para poder construir ese informe después sin reingresar historia.
 */

export const DERECHO_TUTELADO_CODES = [
  'SALUD',
  'SEGURIDAD_SOCIAL',
  'VIDA',
  'MINIMO_VITAL',
  'IGUALDAD',
  'EDUCACION',
  'DEBIDO_PROCESO',
  'DERECHO_DE_PETICION',
  'INFORMACION_PUBLICA',
  'CONTRA_PROVIDENCIAS_JUDICIALES',
  'MEDIO_AMBIENTE',
  'OTROS',
] as const;

export type DerechoTuteladoCode = (typeof DERECHO_TUTELADO_CODES)[number];

export const DERECHO_TUTELADO_LABELS: Record<DerechoTuteladoCode, string> = {
  SALUD: 'Salud',
  SEGURIDAD_SOCIAL: 'Seguridad social',
  VIDA: 'Vida',
  MINIMO_VITAL: 'Mínimo vital',
  IGUALDAD: 'Igualdad',
  EDUCACION: 'Educación',
  DEBIDO_PROCESO: 'Debido proceso',
  DERECHO_DE_PETICION: 'Derecho de petición',
  INFORMACION_PUBLICA: 'Información pública',
  CONTRA_PROVIDENCIAS_JUDICIALES: 'Contra providencias judiciales',
  MEDIO_AMBIENTE: 'Medio ambiente',
  OTROS: 'Otros',
};

export const DECISION_TYPES = [
  'CONCEDE',
  'NIEGA',
  'IMPROCEDENTE',
  'HECHO_SUPERADO',
  'RECHAZA',
  'FALTA_COMPETENCIA',
  'RETIRO_VOLUNTARIO',
  'REMISION',
  'OTRAS',
] as const;

export type DecisionType = (typeof DECISION_TYPES)[number];

export const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  CONCEDE: 'Concede',
  NIEGA: 'Niega',
  IMPROCEDENTE: 'Declara improcedente',
  HECHO_SUPERADO: 'Hecho superado',
  RECHAZA: 'Rechaza',
  FALTA_COMPETENCIA: 'Falta de competencia',
  RETIRO_VOLUNTARIO: 'Retiro voluntario',
  REMISION: 'Remisión / conocimiento previo',
  OTRAS: 'Otras',
};

export function parseDerechoTuteladoCode(raw: unknown): DerechoTuteladoCode | undefined {
  if (typeof raw !== 'string') return undefined;
  return (DERECHO_TUTELADO_CODES as readonly string[]).includes(raw)
    ? (raw as DerechoTuteladoCode)
    : undefined;
}

export function parseDecisionType(raw: unknown): DecisionType | undefined {
  if (typeof raw !== 'string') return undefined;
  return (DECISION_TYPES as readonly string[]).includes(raw) ? (raw as DecisionType) : undefined;
}

/** Heurística al radicar desde texto IA o correo (sin garantía jurídica). */
export function guessDerechoTuteladoCodeFromText(text: string): DerechoTuteladoCode | undefined {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!t.trim()) return undefined;

  const rules: ReadonlyArray<[RegExp, DerechoTuteladoCode]> = [
    [/seguridad social|pension|pensi[oó]n|afiliaci[oó]n|arl\b/, 'SEGURIDAD_SOCIAL'],
    [/salud|eps\b|ips\b|hospital|medic|clinic/, 'SALUD'],
    [/minimo vital|subsistencia/, 'MINIMO_VITAL'],
    [/debido proceso|debida diligencia|tutela por demora/, 'DEBIDO_PROCESO'],
    [/derecho de petici[oó]n|^[^—\n]*—\s*petici[oó]n\b/, 'DERECHO_DE_PETICION'],
    [/informaci[oó]n p[uú]blica|transparencia|habeas data/, 'INFORMACION_PUBLICA'],
    [/medio ambiente|ambiental/, 'MEDIO_AMBIENTE'],
    [/igualdad|no discriminaci[oó]n/, 'IGUALDAD'],
    [/educaci[oó]n|escuela|matricula|icfes/, 'EDUCACION'],
    [/providencia judicial|contra la sentencia|contra auto/, 'CONTRA_PROVIDENCIAS_JUDICIALES'],
    [/vida\b|integridad|riesgo vital/, 'VIDA'],
  ];

  for (const [re, code] of rules) {
    if (re.test(t)) return code;
  }
  return undefined;
}

/**
 * Artículos de la Constitución (CP) frecuentes en tutelas → fila SIERJU.
 * Se usa cuando `derecho_tutelado_code` está vacío pero el texto trae «Art. 29 — …».
 */
const CP_ARTICLE_TO_SIERJU: Readonly<Record<string, DerechoTuteladoCode>> = {
  '11': 'VIDA',
  '12': 'VIDA',
  '13': 'IGUALDAD',
  '20': 'INFORMACION_PUBLICA',
  '23': 'DERECHO_DE_PETICION',
  '27': 'EDUCACION',
  '29': 'DEBIDO_PROCESO',
};

function inferDerechoFromCpArticleLine(text: string): DerechoTuteladoCode | undefined {
  const normalized = text.replace(/\u00a0/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const re = /(?:Art\.|Artículo|Articulo)\s*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const n = m[1];
    const hit = CP_ARTICLE_TO_SIERJU[n];
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Código efectivo para informes: primero el guardado en BD; si falta, artículo CP en texto;
 * si no, palabras clave en `legal_derecho_tutelado`.
 */
export function resolveDerechoTuteladoCodeForInforme(c: {
  derechoTuteladoCode?: DerechoTuteladoCode;
  legalDerechoTutelado?: string;
}): DerechoTuteladoCode | undefined {
  if (c.derechoTuteladoCode) return c.derechoTuteladoCode;
  const legal = (c.legalDerechoTutelado || '').trim();
  if (!legal) return undefined;
  return inferDerechoFromCpArticleLine(legal) ?? guessDerechoTuteladoCodeFromText(legal);
}
