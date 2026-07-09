import type { CaseType } from '../types';

/**
 * Alcance de producto actual: solo tutelas constitucionales.
 * La arquitectura (`process_definitions`, `court_enabled_processes`) admite más tipos;
 * hasta ampliar el alcance, el runtime filtra a estas tres variantes.
 *
 * Para habilitar civil ordinario / laboral / penal: ampliar este arreglo y el selector
 * de radicación (Fase 3); no basta con insertar filas en BD.
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

/** Tipos con flujo implementado en la app (radicación + etapas + plantillas tutela). */
export function filterToMvpProductScope<T extends { legacy_case_type: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => isMvpRadicableCaseType(r.legacy_case_type));
}

/** Tipos civiles habilitados en módulo Procesos (listado + detalle; radicación civil en fase posterior). */
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
    id: 'civil_ordinario',
    emoji: '⚖️',
    title: 'Proceso civil ordinario',
    subtitle: 'Demanda, admisión, contestación y trámite ordinario',
  },
  {
    id: 'civil_ejecutivo',
    emoji: '📑',
    title: 'Proceso ejecutivo',
    subtitle: 'Ejecutivo singular y cobro judicial',
  },
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
