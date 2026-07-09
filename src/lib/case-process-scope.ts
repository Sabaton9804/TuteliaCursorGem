import type { Case, CaseType } from '../types';
import {
  CIVIL_CASE_TYPES,
  isMvpRadicableCaseType,
  type CivilCaseType as CivilCaseTypeConst,
} from './process-product-scope';

export function isCivilCaseType(value: string | null | undefined): value is CivilCaseTypeConst {
  return CIVIL_CASE_TYPES.includes(value as CivilCaseTypeConst);
}

export function isCivilCase(c: Pick<Case, 'caseType'>): boolean {
  return isCivilCaseType(c.caseType);
}

export function isTutelaCase(c: Pick<Case, 'caseType'>): boolean {
  const t = c.caseType ?? 'tutela_primera';
  return isMvpRadicableCaseType(t);
}

export function caseListBackHref(c: Pick<Case, 'caseType'>): string {
  return isCivilCase(c) ? '/procesos/civiles' : '/cases';
}

export function isProcesosCivilListRow(c: Pick<Case, 'caseType' | 'catalogMetadata'>): boolean {
  if (isCivilCaseType(c.caseType)) return true;
  return c.catalogMetadata?.tipo_registro === 'civil';
}

export function mapTipoProcesoToCivilCaseType(tipoProceso: string | null | undefined): CivilCaseTypeConst {
  const t = (tipoProceso || '').toLowerCase();
  if (t.includes('ejecutiv')) return 'civil_ejecutivo';
  if (t.includes('jurisdicci') && t.includes('voluntaria')) return 'civil_jurisdiccion_voluntaria';
  if (t.includes('insolvencia')) return 'civil_insolvencia';
  if (t.includes('otros proceso')) return 'civil_otros';
  return 'civil_ordinario';
}

export function mapInstanciaToTutelaCaseType(instancia: string | null | undefined): CaseType {
  const i = (instancia || '').toLowerCase();
  if (i.includes('segunda') || i.includes('2')) return 'tutela_segunda';
  return 'tutela_primera';
}
