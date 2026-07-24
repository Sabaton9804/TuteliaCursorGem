/**
 * Códigos alineados a TIPOS PROCESOS = derechos fundamentales en hojas SIERJU:
 * - 8 Movimiento de Tutelas
 * - 12 Incidentes de Desacato
 * - 13 Movimiento de Impugnaciones
 * - 15 Consultas Incidentes de Desacato
 *
 * Las 12 etiquetas son idénticas en esas hojas.
 * No usar hoja 7 / 14 (Acciones constitucionales: cumplimiento, grupo, populares, hábeas corpus)
 * para tipificar tutelas, impugnaciones, desacato o consulta.
 */

/** Sección SIERJU por flujo Jurion (formulario Civil Circuito 2023 V.4). */
export const SIERJU_TUTELA_ACTIVE_SECTION = 'movimiento_tutelas' as const;
export const SIERJU_DESACATO_ACTIVE_SECTION = 'incidentes_desacato' as const;
export const SIERJU_IMPUGNACIONES_ACTIVE_SECTION = 'impugnaciones' as const;
export const SIERJU_CONSULTAS_DESACATO_ACTIVE_SECTION = 'consultas_desacato' as const;

export type SierjuDerechoSectionCode =
  | typeof SIERJU_TUTELA_ACTIVE_SECTION
  | typeof SIERJU_DESACATO_ACTIVE_SECTION
  | typeof SIERJU_IMPUGNACIONES_ACTIVE_SECTION
  | typeof SIERJU_CONSULTAS_DESACATO_ACTIVE_SECTION;

const SIERJU_DERECHO_SECTION_META: Record<
  SierjuDerechoSectionCode,
  { sheet: number; title: string }
> = {
  movimiento_tutelas: { sheet: 8, title: 'Movimiento de Tutelas' },
  incidentes_desacato: { sheet: 12, title: 'Incidentes de Desacato' },
  impugnaciones: { sheet: 13, title: 'Movimiento de Impugnaciones' },
  consultas_desacato: { sheet: 15, title: 'Consultas Incidentes de Desacato' },
};

/** Mapea case_type Jurion → sección SIERJU de tipificación por derecho. */
export function sierjuDerechoSectionForCaseType(
  caseType: string | null | undefined,
): SierjuDerechoSectionCode {
  if (caseType === 'tutela_segunda') return SIERJU_IMPUGNACIONES_ACTIVE_SECTION;
  if (caseType === 'consulta_desacato') return SIERJU_CONSULTAS_DESACATO_ACTIVE_SECTION;
  return SIERJU_TUTELA_ACTIVE_SECTION;
}

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

/** Labels exactas TIPOS PROCESOS (hojas 8 / 12 / 13 / 15). */
export const DERECHO_TUTELADO_LABELS: Record<DerechoTuteladoCode, string> = {
  SALUD: 'SALUD',
  SEGURIDAD_SOCIAL: 'SEGURIDAD SOCIAL',
  VIDA: 'VIDA',
  MINIMO_VITAL: 'MÍNIMO VITAL',
  IGUALDAD: 'IGUALDAD',
  EDUCACION: 'EDUCACIÓN',
  DEBIDO_PROCESO: 'DEBIDO PROCESO',
  DERECHO_DE_PETICION: 'DERECHO DE PETICIÓN',
  INFORMACION_PUBLICA: 'DERECHO A LA INFORMACIÓN PÚBLICA',
  CONTRA_PROVIDENCIAS_JUDICIALES: 'CONTRA PROVIDENCIAS JUDICIALES',
  MEDIO_AMBIENTE: 'MEDIO AMBIENTE',
  OTROS: 'OTROS',
};

function normDerechoLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Empareja texto libre / IA con una fila de derechos SIERJU (hojas 8/12/13/15). */
export function matchDerechoTuteladoFromSierjuLabel(
  text: string | null | undefined,
): DerechoTuteladoCode | undefined {
  const raw = String(text || '').trim();
  if (!raw) return undefined;
  const n = normDerechoLabel(raw);
  for (const code of DERECHO_TUTELADO_CODES) {
    if (code === raw || normDerechoLabel(DERECHO_TUTELADO_LABELS[code]) === n) return code;
  }
  for (const code of DERECHO_TUTELADO_CODES) {
    const labelN = normDerechoLabel(DERECHO_TUTELADO_LABELS[code]);
    if (labelN.length >= 5 && (n.includes(labelN) || labelN.includes(n))) return code;
  }
  // OTROS solo por igualdad / etiqueta corta exacta (evita falsos positivos).
  if (n === 'otros' || n === 'otro') return 'OTROS';
  return undefined;
}

/** Lista para prompts IA según hoja SIERJU de derechos. */
export function sierjuDerechoTipoLabelsForPrompt(
  section: SierjuDerechoSectionCode = SIERJU_TUTELA_ACTIVE_SECTION,
): string {
  const meta = SIERJU_DERECHO_SECTION_META[section];
  return (
    `### ${meta.title} (vigente — hoja ${meta.sheet} FORMULARIO)\n` +
    DERECHO_TUTELADO_CODES.map((c) => `- ${DERECHO_TUTELADO_LABELS[c]}`).join('\n')
  );
}

/** @deprecated Preferir {@link sierjuDerechoTipoLabelsForPrompt} con la sección correcta. */
export function sierjuTutelaTipoLabelsForPrompt(): string {
  return sierjuDerechoTipoLabelsForPrompt(SIERJU_TUTELA_ACTIVE_SECTION);
}

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
  const exact = matchDerechoTuteladoFromSierjuLabel(text);
  if (exact) return exact;

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
