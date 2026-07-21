import type { CaseType } from '../types';
import type { ExpedienteCuadernoExtra } from './expediente-extra-cuadernos';

/** Cuaderno principal — primera instancia (equivalente C01). */
export const NOTEBOOK_PI_C01_PRINCIPAL = 'PI_C01_PRINCIPAL';

/** Cuaderno principal — segunda instancia (C01 del proceso en el despacho receptor). */
export const NOTEBOOK_SI_C01_PRINCIPAL = 'SI_C01_PRINCIPAL';

/** Cuaderno de impugnación / traslado en segunda instancia (equiv. carpeta SGDE Impugnación). */
export const NOTEBOOK_SI_IMPUGNACION = 'SI_IMPUGNACION';

/** Ruta lógica SGDE para piezas del traslado en tutela 2ª. */
export const SGDE_PATH_SEGUNDA_IMPUGNACION = 'Segunda instancia / Impugnación';

/** Código histórico usado en datos antiguos; el UI ya no crea este valor por defecto. */
export const NOTEBOOK_PI_INC_DESACATO = 'PI_INC_DESACATO';

/** Cuaderno de medidas cautelares — primera instancia (equivalente C02 / 02CdoCautelar). */
export const NOTEBOOK_PI_C02_CAUTELAR = 'PI_C02_CAUTELAR';

/** Códigos fijos sugeridos al crear cuadernos extra (radicación / expediente). */
export const NOTEBOOK_PI_INC_NULIDAD = 'PI_INC_NULIDAD';
export const NOTEBOOK_PI_INC_EXCEPCIONES = 'PI_INC_EXCEPCIONES';
export const NOTEBOOK_PI_INC_LIQUIDACION_CREDITO = 'PI_INC_LIQUIDACION_CREDITO';
export const NOTEBOOK_PI_INC_LIQUIDACION_COSTAS = 'PI_INC_LIQUIDACION_COSTAS';
export const NOTEBOOK_PI_INC_OBJECIONES = 'PI_INC_OBJECIONES';

export const DEFAULT_NOTEBOOK_CODE = NOTEBOOK_PI_C01_PRINCIPAL;

export type ExpedienteInstanciaCode = 'PI' | 'SI';

export const NOTEBOOK_INSTANCIA: Record<string, ExpedienteInstanciaCode> = {
  [NOTEBOOK_PI_C01_PRINCIPAL]: 'PI',
  [NOTEBOOK_PI_INC_DESACATO]: 'PI',
  [NOTEBOOK_PI_C02_CAUTELAR]: 'PI',
  [NOTEBOOK_PI_INC_NULIDAD]: 'PI',
  [NOTEBOOK_PI_INC_EXCEPCIONES]: 'PI',
  [NOTEBOOK_PI_INC_LIQUIDACION_CREDITO]: 'PI',
  [NOTEBOOK_PI_INC_LIQUIDACION_COSTAS]: 'PI',
  [NOTEBOOK_PI_INC_OBJECIONES]: 'PI',
  [NOTEBOOK_SI_C01_PRINCIPAL]: 'SI',
  [NOTEBOOK_SI_IMPUGNACION]: 'SI',
};

export const INSTANCIA_LABELS: Record<ExpedienteInstanciaCode, string> = {
  PI: 'Primera instancia',
  SI: 'Segunda instancia',
};

export const NOTEBOOK_META: Record<
  string,
  { label: string; shortLabel: string; uploadHint: string; subtitle?: string }
> = {
  [NOTEBOOK_PI_C01_PRINCIPAL]: {
    label: 'Cuaderno principal',
    shortLabel: 'C01 principal',
    subtitle: 'Tutela en trámite · equiv. 01CdoPrincipal',
    uploadHint: 'Arrastra archivos a C01 principal',
  },
  [NOTEBOOK_SI_C01_PRINCIPAL]: {
    label: 'Cuaderno principal',
    shortLabel: 'C01 segunda',
    subtitle: 'Segunda instancia · 01CdoPrincipal',
    uploadHint: 'Arrastra archivos al cuaderno de segunda instancia',
  },
  [NOTEBOOK_SI_IMPUGNACION]: {
    label: 'Impugnación',
    shortLabel: 'Impugnación',
    subtitle: 'Segunda instancia · traslado recibido',
    uploadHint: 'Arrastra archivos a Impugnación',
  },
  [NOTEBOOK_PI_INC_DESACATO]: {
    label: 'Incidente de desacato',
    shortLabel: 'Incidente',
    subtitle: 'Mismo expediente · actuación rogada',
    uploadHint: 'Arrastra archivos a este cuaderno',
  },
  [NOTEBOOK_PI_C02_CAUTELAR]: {
    label: 'Medidas cautelares',
    shortLabel: 'C02 cautelares',
    subtitle: 'Ejecutivo · equiv. 02CdoCautelar',
    uploadHint: 'Arrastra archivos al cuaderno de medidas cautelares',
  },
  [NOTEBOOK_PI_INC_NULIDAD]: {
    label: 'Incidente de nulidad',
    shortLabel: 'Nulidad',
    subtitle: 'Incidente · nulidad procesal',
    uploadHint: 'Arrastra archivos al incidente de nulidad',
  },
  [NOTEBOOK_PI_INC_EXCEPCIONES]: {
    label: 'Excepciones previas',
    shortLabel: 'Excepciones',
    subtitle: 'Cuaderno de excepciones previas',
    uploadHint: 'Arrastra archivos al cuaderno de excepciones',
  },
  [NOTEBOOK_PI_INC_LIQUIDACION_CREDITO]: {
    label: 'Liquidación de crédito',
    shortLabel: 'Liq. crédito',
    subtitle: 'Ejecutivo · liquidación del crédito',
    uploadHint: 'Arrastra archivos a liquidación de crédito',
  },
  [NOTEBOOK_PI_INC_LIQUIDACION_COSTAS]: {
    label: 'Liquidación de costas',
    shortLabel: 'Liq. costas',
    subtitle: 'Liquidación de costas procesales',
    uploadHint: 'Arrastra archivos a liquidación de costas',
  },
  [NOTEBOOK_PI_INC_OBJECIONES]: {
    label: 'Objeciones',
    shortLabel: 'Objeciones',
    subtitle: 'Objeciones a dictámenes o liquidaciones',
    uploadHint: 'Arrastra archivos al cuaderno de objeciones',
  },
};

export function cautelarNotebookExtra(): ExpedienteCuadernoExtra {
  return {
    code: NOTEBOOK_PI_C02_CAUTELAR,
    label: NOTEBOOK_META[NOTEBOOK_PI_C02_CAUTELAR].label,
  };
}

export function segundaImpugnacionNotebookExtra(): ExpedienteCuadernoExtra {
  return {
    code: NOTEBOOK_SI_IMPUGNACION,
    label: NOTEBOOK_META[NOTEBOOK_SI_IMPUGNACION].label,
  };
}

export function caseHasCautelarNotebook(
  extras: ExpedienteCuadernoExtra[] | undefined | null
): boolean {
  return (extras || []).some(
    (e) => normalizeNotebookCode(e.code) === NOTEBOOK_PI_C02_CAUTELAR
  );
}

export function instanciaForNotebook(code: string): ExpedienteInstanciaCode {
  const c = normalizeNotebookCode(code);
  const mapped = NOTEBOOK_INSTANCIA[c];
  if (mapped) return mapped;
  if (c.startsWith('SI_')) return 'SI';
  if (c.startsWith('PI_')) return 'PI';
  return 'PI';
}

export function notebookCodeForCaseType(caseType: CaseType | null | undefined): string {
  if (caseType === 'tutela_segunda') return NOTEBOOK_SI_C01_PRINCIPAL;
  return NOTEBOOK_PI_C01_PRINCIPAL;
}

/** Alias históricos → código canónico de UI. */
const NOTEBOOK_CODE_ALIASES: Record<string, string> = {
  PI_PRINCIPAL: NOTEBOOK_PI_C01_PRINCIPAL,
  C01_PRINCIPAL: NOTEBOOK_PI_C01_PRINCIPAL,
  '01CdoPrincipal': NOTEBOOK_PI_C01_PRINCIPAL,
  C02_CAUTELAR: NOTEBOOK_PI_C02_CAUTELAR,
  '02CdoCautelar': NOTEBOOK_PI_C02_CAUTELAR,
  PI_C02_CAUTELARES: NOTEBOOK_PI_C02_CAUTELAR,
};

export function normalizeNotebookCode(code: string | undefined | null): string {
  const c = (code || '').trim();
  if (!c) return DEFAULT_NOTEBOOK_CODE;
  return NOTEBOOK_CODE_ALIASES[c] ?? c;
}

export type PredefinedNotebookSuggestion = {
  code: string;
  label: string;
  /** Fragmentos para autocompletar (sin tildes, minúsculas). */
  aliases: string[];
};

/** Catálogo sugerido al digitar el nombre del cuaderno. */
export const PREDEFINED_NOTEBOOK_SUGGESTIONS: PredefinedNotebookSuggestion[] = [
  {
    code: NOTEBOOK_PI_C02_CAUTELAR,
    label: NOTEBOOK_META[NOTEBOOK_PI_C02_CAUTELAR].label,
    aliases: ['med', 'medida', 'medidas', 'cautelar', 'cautelares', 'c02', '02'],
  },
  {
    code: NOTEBOOK_PI_INC_DESACATO,
    label: NOTEBOOK_META[NOTEBOOK_PI_INC_DESACATO].label,
    aliases: ['desacato', 'des', 'incidente desacato'],
  },
  {
    code: NOTEBOOK_PI_INC_NULIDAD,
    label: NOTEBOOK_META[NOTEBOOK_PI_INC_NULIDAD].label,
    aliases: ['nul', 'nulidad', 'incidente nulidad'],
  },
  {
    code: NOTEBOOK_PI_INC_EXCEPCIONES,
    label: NOTEBOOK_META[NOTEBOOK_PI_INC_EXCEPCIONES].label,
    aliases: ['exc', 'excepcion', 'excepciones', 'previas'],
  },
  {
    code: NOTEBOOK_PI_INC_LIQUIDACION_CREDITO,
    label: NOTEBOOK_META[NOTEBOOK_PI_INC_LIQUIDACION_CREDITO].label,
    aliases: ['liq', 'liquidacion', 'credito', 'crédito'],
  },
  {
    code: NOTEBOOK_PI_INC_LIQUIDACION_COSTAS,
    label: NOTEBOOK_META[NOTEBOOK_PI_INC_LIQUIDACION_COSTAS].label,
    aliases: ['costas', 'liquidacion costas'],
  },
  {
    code: NOTEBOOK_PI_INC_OBJECIONES,
    label: NOTEBOOK_META[NOTEBOOK_PI_INC_OBJECIONES].label,
    aliases: ['obj', 'objecion', 'objeciones'],
  },
];

function foldSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Sugerencias de cuaderno predefinido según lo digitado.
 * Con query vacío devuelve el catálogo (menos los ya presentes).
 */
export function matchPredefinedNotebooks(
  query: string,
  alreadyPresentCodes: Iterable<string> = []
): PredefinedNotebookSuggestion[] {
  const present = new Set(
    [...alreadyPresentCodes].map((c) => normalizeNotebookCode(c))
  );
  const q = foldSearchText(query);
  return PREDEFINED_NOTEBOOK_SUGGESTIONS.filter((item) => {
    if (present.has(normalizeNotebookCode(item.code))) return false;
    if (!q) return true;
    const labelFold = foldSearchText(item.label);
    if (labelFold.includes(q) || labelFold.split(/\s+/).some((w) => w.startsWith(q))) {
      return true;
    }
    return item.aliases.some((a) => {
      const af = foldSearchText(a);
      return af.startsWith(q) || af.includes(q) || q.startsWith(af);
    });
  });
}
