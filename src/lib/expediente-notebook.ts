import type { CaseType } from '../types';

/** Cuaderno principal — primera instancia (equivalente C01). */
export const NOTEBOOK_PI_C01_PRINCIPAL = 'PI_C01_PRINCIPAL';

/** Cuaderno principal — segunda instancia (C01 del proceso en el despacho receptor). */
export const NOTEBOOK_SI_C01_PRINCIPAL = 'SI_C01_PRINCIPAL';

/** Código histórico usado en datos antiguos; el UI ya no crea este valor por defecto. */
export const NOTEBOOK_PI_INC_DESACATO = 'PI_INC_DESACATO';

export const DEFAULT_NOTEBOOK_CODE = NOTEBOOK_PI_C01_PRINCIPAL;

export const NOTEBOOK_META: Record<
  string,
  { label: string; shortLabel: string; uploadHint: string }
> = {
  [NOTEBOOK_PI_C01_PRINCIPAL]: {
    label: 'Cuaderno principal (C01)',
    shortLabel: 'C01 principal',
    uploadHint: 'Arrastra archivos a C01 principal',
  },
  [NOTEBOOK_SI_C01_PRINCIPAL]: {
    label: 'Cuaderno segunda instancia (C01)',
    shortLabel: 'C01 segunda',
    uploadHint: 'Arrastra archivos al cuaderno de segunda instancia',
  },
  [NOTEBOOK_PI_INC_DESACATO]: {
    label: 'Incidente (cuaderno histórico)',
    shortLabel: 'Incidente',
    uploadHint: 'Arrastra archivos a este cuaderno',
  },
};

export function notebookCodeForCaseType(caseType: CaseType | null | undefined): string {
  if (caseType === 'tutela_segunda') return NOTEBOOK_SI_C01_PRINCIPAL;
  return NOTEBOOK_PI_C01_PRINCIPAL;
}

export function normalizeNotebookCode(code: string | undefined | null): string {
  const c = (code || '').trim();
  return c.length > 0 ? c : DEFAULT_NOTEBOOK_CODE;
}
