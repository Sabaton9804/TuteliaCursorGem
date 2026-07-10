import type { CaseType } from '../types';
import { CIVIL_CASE_TYPES, type CivilCaseType, isCivilCaseType } from './process-product-scope';
import type { CaseStageCode } from './case-workflow-stages';

const SGDE_BLOCKED: ReadonlySet<CaseType> = new Set(['tutela_segunda', 'consulta_desacato']);

/** Tipos de expediente que pueden crearse o vincularse automáticamente en SGDE. */
export function isSgdeAutoCreateCaseType(caseType: CaseType | null | undefined): boolean {
  const t = caseType ?? 'tutela_primera';
  if (SGDE_BLOCKED.has(t)) return false;
  if (t === 'tutela_primera') return true;
  return CIVIL_CASE_TYPES.includes(t as CivilCaseType);
}

export function isCivilEjecutivoCaseType(caseType: CaseType | null | undefined): boolean {
  return caseType === 'civil_ejecutivo';
}

/** Etapa de término tras notificación del auto admisorio / mandamiento. */
export function initialResponseTermStageForCaseType(caseType: CaseType): CaseStageCode {
  if (caseType === 'civil_ejecutivo') return 'TERMINO_EXCEPCIONES';
  if (caseType === 'tutela_primera' || isCivilCaseType(caseType)) return 'TERMINO_RESPUESTA';
  return 'TERMINO_RESPUESTA';
}

export function supportsContestacionWorkflow(caseType: CaseType): boolean {
  return caseType === 'tutela_primera' || CIVIL_CASE_TYPES.includes(caseType as CivilCaseType);
}

export function supportsApelacionWorkflow(caseType: CaseType): boolean {
  return isCivilCaseType(caseType);
}

export function supportsNotificacionFalloWorkflow(caseType: CaseType): boolean {
  if (caseType === 'tutela_segunda') return true;
  if (supportsContestacionWorkflow(caseType)) return true;
  return false;
}
