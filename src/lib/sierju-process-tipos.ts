import type { CivilCaseType } from './process-product-scope';

/**
 * Tipos de proceso SIERJU — Juzgado Civil Circuito 2023 V.4
 * Fuente vigente: hoja 2 del formulario (Civil-Oral).
 * Civil-Escrito (hoja 1) = legislación anterior; no usar en radicación ni IA.
 * Labels deben coincidir textualemente con TIPOS PROCESOS del formulario.
 */

export type SierjuProcessTipo = {
  code: string;
  label: string;
  /** Sección del formulario SIERJU. Vigente: solo civil_1a_oral. */
  sectionCode: 'civil_1a_escrito' | 'civil_1a_oral';
  /** Pipeline operativo Tutelia (colapsado). */
  caseType: CivilCaseType;
};

/** Sección SIERJU activa para procesos civiles de 1ª (CGP / oralidad). */
export const SIERJU_CIVIL_ACTIVE_SECTION = 'civil_1a_oral' as const;

function tipo(
  code: string,
  label: string,
  sectionCode: SierjuProcessTipo['sectionCode'],
  caseType: CivilCaseType,
): SierjuProcessTipo {
  return { code, label, sectionCode, caseType };
}

/**
 * @deprecated Legislación anterior (Civil-Escrito). Conservado solo como referencia histórica;
 * no usar en UI/IA. Preferir {@link SIERJU_CIVIL_1A_ORAL}.
 */
export const SIERJU_CIVIL_1A_ESCRITO: readonly SierjuProcessTipo[] = [
  tipo('declarativos_ordinarios', 'DECLARATIVOS - ORDINARIOS', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('declarativos_abreviados', 'DECLARATIVOS - ABREVIADOS', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('declarativos_verbales', 'DECLARATIVOS - VERBALES', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('declarativos_verbal_sumario', 'DECLARATIVOS - VERBAL SUMARIO', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('declarativos_divisorios', 'DECLARATIVOS - DIVISORIOS', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('declarativos_otros', 'DECLARATIVOS - OTROS', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('ejecutivos', 'EJECUTIVOS', 'civil_1a_escrito', 'civil_ejecutivo'),
  tipo('ejecutivos_hipotecario', 'EJECUTIVOS - HIPOTECARIO', 'civil_1a_escrito', 'civil_ejecutivo'),
  tipo('insolvencia_persona_natural', 'INSOLVENCIA DE PERSONA NATURAL', 'civil_1a_escrito', 'civil_insolvencia'),
  tipo('insolvencia_sociedades', 'INSOLVENCIA DE SOCIEDADES', 'civil_1a_escrito', 'civil_insolvencia'),
  tipo(
    'liquidacion_sociedades_incumplimiento_reorg',
    'PROCESOS DE LIQUIDACIÓN - LIQUIDACIÓN DE SOCIEDADES POR INCUMPLIMIENTO DE ACUERDO DE REORGANIZACIÓN',
    'civil_1a_escrito',
    'civil_insolvencia',
  ),
  tipo(
    'liquidacion_disolucion_nulidad_sociedades',
    'PROCESOS DE LIQUIDACIÓN - DISOLUCIÓN, NULIDAD Y LIQUIDACIÓN DE SOCIEDADES',
    'civil_1a_escrito',
    'civil_insolvencia',
  ),
  tipo('liquidacion_otros', 'PROCESOS DE LIQUIDACIÓN - OTROS', 'civil_1a_escrito', 'civil_insolvencia'),
  tipo(
    'jurisdiccion_voluntaria',
    'PROCESOS DE JURISDICCIÓN VOLUNTARIA',
    'civil_1a_escrito',
    'civil_jurisdiccion_voluntaria',
  ),
  tipo('pertenencia', 'PROCESOS DE PERTENENCIA', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('servidumbres', 'SERVIDUMBRES', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('titulacion_predios', 'TITULACIÓN DE PREDIOS', 'civil_1a_escrito', 'civil_ordinario'),
  tipo(
    'liquidacion_sociedades_patrimoniales_hecho',
    'LIQUIDACIÓN DE SOCIEDADES PATRIMONIALES DE HECHO',
    'civil_1a_escrito',
    'civil_ordinario',
  ),
  tipo('expropiacion', 'EXPROPIACIÓN', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('deslinde_amojonamiento', 'DESLINDE Y AMOJONAMIENTO', 'civil_1a_escrito', 'civil_ordinario'),
  tipo(
    'impugnacion_actas_asambleas',
    'IMPUGNACIÓN DE ACTAS DE ASAMBLEAS, JUNTAS DIRECTIVAS O DE SOCIOS.',
    'civil_1a_escrito',
    'civil_ordinario',
  ),
  tipo('competencia_desleal', 'COMPETENCIA DESLEAL', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('rc_extracontractual', 'RESPONSABILIDAD CIVIL EXTRACONTRACTUAL', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('rc_contractual', 'RESPONSABILIDAD CIVIL CONTRACTUAL', 'civil_1a_escrito', 'civil_ordinario'),
  tipo('conciliacion_extrajudicial', 'CONCILIACIÓN EXTRAJUDICIAL', 'civil_1a_escrito', 'civil_otros'),
  tipo('otros_procesos', 'OTROS PROCESOS', 'civil_1a_escrito', 'civil_otros'),
];

/** Primera y única instancia Civil-Oral (24 clases) — ÚNICA sección vigente en radicación. */
export const SIERJU_CIVIL_1A_ORAL: readonly SierjuProcessTipo[] = [
  tipo('declarativos_verbal_pertenencia', 'DECLARATIVOS VERBAL PERTENENCIA', 'civil_1a_oral', 'civil_ordinario'),
  tipo('declarativos_verbal_servidumbres', 'DECLARATIVOS VERBAL SERVIDUMBRES', 'civil_1a_oral', 'civil_ordinario'),
  tipo(
    'declarativos_verbal_impugnacion_actas',
    'DECLARATIVOS - VERBAL-IMPUGNACIÓN DE ACTAS DE ASAMBLEAS, JUNTAS DIRECTIVAS O DE SOCIOS.',
    'civil_1a_oral',
    'civil_ordinario',
  ),
  tipo(
    'declarativos_verbal_bienes_vacantes',
    'DECLARATIVOS VERBAL DECLARACIÓN DE BIENES VACANTES O MOSTRENCOS',
    'civil_1a_oral',
    'civil_ordinario',
  ),
  tipo('declarativos_especiales_divisorio', 'DECLARATIVOS ESPECIALES DIVISORIO', 'civil_1a_oral', 'civil_ordinario'),
  tipo('declarativos_especiales_expropiacion', 'DECLARATIVOS ESPECIALES EXPROPIACIÓN', 'civil_1a_oral', 'civil_ordinario'),
  tipo(
    'declarativos_especiales_deslinde',
    'DECLARATIVOS ESPECIALES DESLINDE Y AMOJONAMIENTO',
    'civil_1a_oral',
    'civil_ordinario',
  ),
  tipo('ejecutivos', 'EJECUTIVOS', 'civil_1a_oral', 'civil_ejecutivo'),
  tipo('ejecutivos_garantia_real', 'EJECUTIVOS CON GARANTÍA REAL', 'civil_1a_oral', 'civil_ejecutivo'),
  tipo('responsabilidad_medica', 'RESPONSABILIDAD MEDICA', 'civil_1a_oral', 'civil_ordinario'),
  tipo('rc_extracontractual', 'RESPONSABILIDAD CIVIL EXTRACONTRACTUAL', 'civil_1a_oral', 'civil_ordinario'),
  tipo('rc_contractual', 'RESPONSABILIDAD CIVIL CONTRACTUAL', 'civil_1a_oral', 'civil_ordinario'),
  tipo('insolvencia_persona_natural', 'INSOLVENCIA DE LA PERSONA NATURAL', 'civil_1a_oral', 'civil_insolvencia'),
  tipo('insolvencia_sociedades', 'INSOLVENCIA DE SOCIEDADES', 'civil_1a_oral', 'civil_insolvencia'),
  tipo(
    'liquidacion_sociedades_incumplimiento_reorg',
    'PROCESOS DE LIQUIDACIÓN - LIQUIDACIÓN DE SOCIEDADES POR INCUMPLIMIENTO DE ACUERDO DE REORGANIZACIÓN',
    'civil_1a_oral',
    'civil_insolvencia',
  ),
  tipo(
    'liquidacion_disolucion_nulidad_sociedades',
    'PROCESOS DE LIQUIDACIÓN - DISOLUCIÓN, NULIDAD Y LIQUIDACIÓN DE SOCIEDADES',
    'civil_1a_oral',
    'civil_insolvencia',
  ),
  tipo('liquidacion_otros', 'PROCESOS DE LIQUIDACIÓN - OTROS', 'civil_1a_oral', 'civil_insolvencia'),
  tipo(
    'jurisdiccion_voluntaria',
    'PROCESOS DE JURISDICCIÓN VOLUNTARIA',
    'civil_1a_oral',
    'civil_jurisdiccion_voluntaria',
  ),
  tipo('competencia_desleal', 'COMPETENCIA DESLEAL', 'civil_1a_oral', 'civil_ordinario'),
  tipo('propiedad_intelectual', 'PROPIEDAD INTELECTUAL', 'civil_1a_oral', 'civil_ordinario'),
  tipo(
    'proteccion_consumidor',
    'PROCESOS DE PROTECCIÓN DE DERECHO AL CONSUMIDOR',
    'civil_1a_oral',
    'civil_ordinario',
  ),
  tipo(
    'declaratoria_ausencia_desaparicion',
    'DECLARATORIA DE AUSENCIA POR DESAPARICIÓN FORZADA',
    'civil_1a_oral',
    'civil_ordinario',
  ),
  tipo('conciliacion_extrajudicial', 'CONCILIACIÓN EXTRAJUDICIAL', 'civil_1a_oral', 'civil_otros'),
  tipo('otros_procesos', 'OTROS PROCESOS', 'civil_1a_oral', 'civil_otros'),
];

/** Catálogo civil vigente (solo Oral). */
export const SIERJU_CIVIL_CIRCUITO_TIPOS: readonly SierjuProcessTipo[] = SIERJU_CIVIL_1A_ORAL;

export function mapSierjuClassCodeToCaseType(code: string | null | undefined): CivilCaseType {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return 'civil_ordinario';
  const hit = SIERJU_CIVIL_1A_ORAL.find((t) => t.code === c);
  if (hit) return hit.caseType;
  if (c.startsWith('ejecutivos')) return 'civil_ejecutivo';
  if (c.startsWith('insolvencia') || c.startsWith('liquidacion_')) return 'civil_insolvencia';
  if (c.includes('jurisdiccion_voluntaria')) return 'civil_jurisdiccion_voluntaria';
  if (c === 'otros_procesos' || c.includes('conciliacion')) return 'civil_otros';
  return 'civil_ordinario';
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Empareja texto libre (IA/correo) con filas SIERJU Civil-Oral vigentes. */
export function matchSierjuTipoFromText(
  text: string | null | undefined,
  _opts?: { preferSection?: SierjuProcessTipo['sectionCode'] },
): SierjuProcessTipo | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const n = norm(raw);
  const pool = SIERJU_CIVIL_1A_ORAL;

  for (const t of pool) {
    if (norm(t.label) === n || t.code === raw || t.code === n.replace(/\s+/g, '_')) return t;
  }
  for (const t of pool) {
    if (n.includes(norm(t.label))) return t;
  }

  const rules: Array<{ re: RegExp; code: string }> = [
    { re: /garant[ií]a\s+real/, code: 'ejecutivos_garantia_real' },
    { re: /\bejecutiv/, code: 'ejecutivos' },
    { re: /insolvencia.*persona\s+natural|persona\s+natural.*insolvencia/, code: 'insolvencia_persona_natural' },
    { re: /insolvencia.*sociedad|sociedad.*insolvencia/, code: 'insolvencia_sociedades' },
    { re: /\binsolvencia\b/, code: 'insolvencia_persona_natural' },
    { re: /jurisdicci[oó]n\s+voluntaria/, code: 'jurisdiccion_voluntaria' },
    { re: /pertenencia/, code: 'declarativos_verbal_pertenencia' },
    { re: /servidumbre/, code: 'declarativos_verbal_servidumbres' },
    { re: /bienes\s+vacantes|mostrenc/, code: 'declarativos_verbal_bienes_vacantes' },
    { re: /impugnaci[oó]n\s+de\s+actas|juntas\s+directivas/, code: 'declarativos_verbal_impugnacion_actas' },
    { re: /\bdivisori/, code: 'declarativos_especiales_divisorio' },
    { re: /expropiaci/, code: 'declarativos_especiales_expropiacion' },
    { re: /deslinde|amojonamiento/, code: 'declarativos_especiales_deslinde' },
    { re: /responsabilidad\s+medic/, code: 'responsabilidad_medica' },
    { re: /extracontractual/, code: 'rc_extracontractual' },
    { re: /contractual/, code: 'rc_contractual' },
    { re: /competencia\s+desleal/, code: 'competencia_desleal' },
    { re: /propiedad\s+intelectual/, code: 'propiedad_intelectual' },
    { re: /consumidor/, code: 'proteccion_consumidor' },
    { re: /desaparici[oó]n\s+forzada|declaratoria\s+de\s+ausencia/, code: 'declaratoria_ausencia_desaparicion' },
    { re: /conciliaci[oó]n\s+extrajudicial/, code: 'conciliacion_extrajudicial' },
  ];
  for (const r of rules) {
    if (r.re.test(n)) {
      return pool.find((t) => t.code === r.code) ?? null;
    }
  }
  return null;
}

/** Labels SIERJU vigentes (Civil-Oral) para prompts de IA. */
export function sierjuCivilTipoLabelsForPrompt(
  _section: 'escrito' | 'oral' | 'both' = 'oral',
): string {
  return (
    `### Primera y única instancia Civil-Oral (vigente — hoja 2 FORMULARIO)\n` +
    SIERJU_CIVIL_1A_ORAL.map((t) => `- ${t.label}`).join('\n')
  );
}

export function findSierjuTipoByCode(
  code: string | null | undefined,
  _preferSection: SierjuProcessTipo['sectionCode'] = SIERJU_CIVIL_ACTIVE_SECTION,
): SierjuProcessTipo | null {
  const c = String(code || '').trim();
  if (!c) return null;
  return SIERJU_CIVIL_1A_ORAL.find((t) => t.code === c) ?? null;
}
