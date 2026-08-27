import type { CaseType } from '../types';
import { isCivilCaseType } from './process-product-scope';
import {
  getCachedPipelineForCaseType,
  getCachedProcessDefinitionByCaseType,
} from './process-definitions-service';
import { initialResponseTermStageForCaseType } from './sgde-case-scope';
import { nextStageInPipeline, type CaseStageCode } from './case-workflow-stages';
import type { ProcessStageTransitionRow } from './process-definition-types';

export function getTransitionsForCaseType(caseType: CaseType | undefined): readonly ProcessStageTransitionRow[] {
  return getCachedProcessDefinitionByCaseType(caseType)?.transitions ?? [];
}

/** Ramas no lineales (INADMISION, RECHAZO, TRAMITE desde término, etc.). */
export function getBranchTransitionsFromStage(
  caseType: CaseType | undefined,
  fromStage: CaseStageCode,
): ProcessStageTransitionRow[] {
  return getTransitionsForCaseType(caseType).filter(
    (t) => t.from_stage_code === fromStage && !t.is_default,
  );
}

/** Transición marcada `is_default` en grafo BD, si existe. */
export function getDefaultTransitionTarget(
  caseType: CaseType | undefined,
  fromStage: CaseStageCode,
): CaseStageCode | null {
  const hit = getTransitionsForCaseType(caseType).find(
    (t) => t.from_stage_code === fromStage && t.is_default,
  );
  return hit ? (hit.to_stage_code as CaseStageCode) : null;
}

/** Siguiente etapa en carril lineal (pipeline BD o fallback TS). */
export function getLinearNextStage(
  caseType: CaseType | undefined,
  fromStage: CaseStageCode,
): CaseStageCode | null {
  const pipeline = getCachedPipelineForCaseType(caseType);
  return nextStageInPipeline(pipeline, fromStage);
}

/**
 * Resuelve etapa destino: transición BD explícita → default BD → siguiente en pipeline → fallback duro.
 */
export function resolveNextStageCode(
  caseType: CaseType | undefined,
  fromStage: CaseStageCode,
  opts?: { explicitTo?: CaseStageCode },
): CaseStageCode | null {
  if (opts?.explicitTo) {
    const allowed = getTransitionsForCaseType(caseType).some(
      (t) => t.from_stage_code === fromStage && t.to_stage_code === opts.explicitTo,
    );
    if (allowed || getLinearNextStage(caseType, fromStage) === opts.explicitTo) {
      return opts.explicitTo;
    }
  }
  const fromDefault = getDefaultTransitionTarget(caseType, fromStage);
  if (fromDefault) return fromDefault;
  const linear = getLinearNextStage(caseType, fromStage);
  if (linear) return linear;
  return null;
}

/** Vencimiento de contestación / excepciones → trámite (civil) o ingreso despacho (tutela). */
export function resolveTerminoRespuestaVencidoNext(caseType: CaseType): CaseStageCode {
  const from = initialResponseTermStageForCaseType(caseType);
  if (!isCivilCaseType(caseType)) {
    const linear = getLinearNextStage(caseType, from);
    return linear ?? 'INGRESO_DESPACHO_FALLO';
  }
  const transitions = getBranchTransitionsFromStage(caseType, from);
  const tramite = transitions.find((t) => t.to_stage_code === 'TRAMITE');
  if (tramite) return 'TRAMITE';
  const ingreso = transitions.find((t) => t.to_stage_code === 'INGRESO_DESPACHO_FALLO');
  if (ingreso) return 'INGRESO_DESPACHO_FALLO';
  const linear = getLinearNextStage(caseType, from);
  if (linear) return linear;
  return 'TRAMITE';
}

/** Etapas destino de archivo por rama (INADMISION/RECHAZO → EJECUTORIA). */
export function resolveArchivoBranchTarget(
  caseType: CaseType | undefined,
  branchStage: 'INADMISION' | 'RECHAZO',
): CaseStageCode {
  const hit = getTransitionsForCaseType(caseType).find(
    (t) => t.from_stage_code === branchStage && t.to_stage_code === 'EJECUTORIA',
  );
  return (hit?.to_stage_code as CaseStageCode) ?? 'EJECUTORIA';
}
