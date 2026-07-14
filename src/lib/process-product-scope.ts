import type { CaseType } from '../types';

/**
 * Tutelas constitucionales con flujo operativo completo (MVP).
 */
export const MVP_RADICABLE_CASE_TYPES = [
  'tutela_primera',
  'tutela_segunda',
  'consulta_desacato',
] as const satisfies readonly CaseType[];

export type MvpRadicableCaseType = (typeof MVP_RADICABLE_CASE_TYPES)[number];

export function isMvpRadicableCaseType(value: string | null | undefined): value is CaseType {
  return MVP_RADICABLE_CASE_TYPES.includes(value as MvpRadicableCaseType);
}

/** Tipos civiles habilitados en módulo Procesos. */
export const CIVIL_CASE_TYPES = [
  'civil_ordinario',
  'civil_ejecutivo',
  'civil_jurisdiccion_voluntaria',
  'civil_insolvencia',
  'civil_otros',
] as const satisfies readonly CaseType[];

export type CivilCaseType = (typeof CIVIL_CASE_TYPES)[number];

export function isCivilCaseType(value: string | null | undefined): value is CivilCaseType {
  return CIVIL_CASE_TYPES.includes(value as CivilCaseType);
}

/** Tipos radicables en UI (tutela MVP + procesos civiles). */
export const RADICABLE_CASE_TYPES = [
  ...MVP_RADICABLE_CASE_TYPES,
  ...CIVIL_CASE_TYPES,
] as const satisfies readonly CaseType[];

export type RadicableCaseType = (typeof RADICABLE_CASE_TYPES)[number];

export function isRadicableCaseType(value: string | null | undefined): value is CaseType {
  return (RADICABLE_CASE_TYPES as readonly string[]).includes(String(value ?? ''));
}

/** Tipos con flujo tutela completo (radicación + etapas + plantillas tutela). */
export function filterToMvpProductScope<T extends { legacy_case_type: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => isMvpRadicableCaseType(r.legacy_case_type));
}

/** Definiciones habilitadas en despacho: tutela MVP + dominio civil. */
export function filterToEnabledCourtProcesses<
  T extends { legacy_case_type: string | null; process_domain?: string },
>(rows: T[]): T[] {
  return rows.filter(
    (r) => isMvpRadicableCaseType(r.legacy_case_type) || r.process_domain === 'civil',
  );
}

/** Vista previa en UI: procesos planeados, aún no radicables. */
export type ComingSoonProcessPreview = {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
};

export const COMING_SOON_PROCESS_PREVIEWS: readonly ComingSoonProcessPreview[] = [
  {
    id: 'laboral_ordinario',
    emoji: '👷',
    title: 'Proceso laboral',
    subtitle: 'Ordinario laboral y ejecutivo laboral',
  },
  {
    id: 'penal',
    emoji: '🏛️',
    title: 'Proceso penal',
    subtitle: 'Trámite penal (circuito / conocimiento)',
  },
];

export const CIVIL_PROCESS_CARD_COPY: Record<
  CivilCaseType,
  { emoji: string; title: string; subtitle: string }
> = {
  civil_ordinario: {
    emoji: '⚖️',
    title: 'Civil (declarativos y asimilados)',
    subtitle: 'Filas SIERJU: DECLARATIVOS, pertenencia, RC, etc.',
  },
  civil_ejecutivo: {
    emoji: '📑',
    title: 'Civil — EJECUTIVOS',
    subtitle: 'SIERJU: EJECUTIVOS / EJECUTIVOS - HIPOTECARIO',
  },
  civil_jurisdiccion_voluntaria: {
    emoji: '📋',
    title: 'PROCESOS DE JURISDICCIÓN VOLUNTARIA',
    subtitle: 'Fila SIERJU exacta',
  },
  civil_insolvencia: {
    emoji: '🏦',
    title: 'Insolvencia / liquidación',
    subtitle: 'SIERJU: INSOLVENCIA… y PROCESOS DE LIQUIDACIÓN…',
  },
  civil_otros: {
    emoji: '📁',
    title: 'OTROS PROCESOS / conciliación',
    subtitle: 'SIERJU: OTROS PROCESOS, CONCILIACIÓN EXTRAJUDICIAL',
  },
};
