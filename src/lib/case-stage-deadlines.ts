import type { CaseType } from '../types';
import {
  CONTESTACION_BUSINESS_DAYS,
  IMPUGNACION_BUSINESS_DAYS,
  businessDayTermEnd,
  businessDayTermEndAfterEvent,
  inclusiveBusinessDaysBetween,
  startOfLocalDay,
} from './business-days';
import { CONTESTACION_CIVIL_BUSINESS_DAYS, APELACION_CIVIL_BUSINESS_DAYS, EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS } from './civil-business-days';
import { isCivilCaseType } from './process-product-scope';
import { isCivilEjecutivoCaseType } from './sgde-case-scope';
import type { CaseStageCode } from './case-workflow-stages';
import { getCachedStageTermBusinessDays } from './process-definitions-service';

export const META_STAGE_DEADLINE_AT = 'stage_deadline_at';
export const META_STAGE_DEADLINE_KIND = 'stage_deadline_kind';
export const META_STAGE_DEADLINE_DAYS = 'stage_deadline_business_days';

export type StageDeadlineKind = 'contestacion_accionados' | 'impugnacion' | 'apelacion' | 'excepciones_ejecutivo';

/** Cómo contar el término desde la fecha ancla. */
export type StageTermCountMode = 'inclusive_event' | 'following_event';

export function stageDeadlineFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = metadata?.[META_STAGE_DEADLINE_AT];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Seed julio 2026: excepciones ejecutivo = 5 (art. 443) y apelación = 10 (art. 318).
 * Esos valores son citas erróneas; ignorarlos hasta que corra
 * `20260827155000_fix_cgp_civil_term_articles.sql`.
 */
export function isStaleCgpStageTerm(
  stageCode: CaseStageCode,
  days: number,
  caseType?: CaseType,
): boolean {
  if (!caseType || !isCivilCaseType(caseType)) return false;
  if (stageCode === 'TERMINO_EXCEPCIONES' && days === 5) return true;
  if (stageCode === 'TERMINO_APELACION' && days === 10) return true;
  return false;
}

function resolveStageTermBusinessDays(
  stageCode: CaseStageCode,
  caseType?: CaseType,
): number | null {
  const fromBd = getCachedStageTermBusinessDays(caseType, stageCode);
  if (fromBd != null && !isStaleCgpStageTerm(stageCode, fromBd, caseType)) return fromBd;
  if (stageCode === 'TERMINO_RESPUESTA') {
    if (caseType && isCivilCaseType(caseType)) return CONTESTACION_CIVIL_BUSINESS_DAYS;
    return CONTESTACION_BUSINESS_DAYS;
  }
  if (stageCode === 'TERMINO_EXCEPCIONES') return EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS;
  if (stageCode === 'TERMINO_APELACION') return APELACION_CIVIL_BUSINESS_DAYS;
  if (stageCode === 'TERMINO_IMPUGNACION') return IMPUGNACION_BUSINESS_DAYS;
  return null;
}

function stageTermCountModeForStage(stageCode: CaseStageCode): StageTermCountMode {
  if (
    stageCode === 'TERMINO_RESPUESTA' ||
    stageCode === 'TERMINO_EXCEPCIONES' ||
    stageCode === 'TERMINO_IMPUGNACION' ||
    stageCode === 'TERMINO_APELACION'
  ) {
    return 'following_event';
  }
  return 'inclusive_event';
}

function stageDeadlineFromTerm(
  start: Date,
  termBusinessDays: number,
  mode: StageTermCountMode = 'following_event',
): Date {
  const day = startOfLocalDay(start);
  if (mode === 'inclusive_event') return businessDayTermEnd(day, termBusinessDays);
  return businessDayTermEndAfterEvent(day, termBusinessDays);
}

/** Plazo secundario de la etapa abierta (contestación / impugnación, etc.). */
export function resolveSubStageDeadline(
  stageCode: CaseStageCode,
  enteredAt: string,
  metadata: Record<string, unknown> | null | undefined,
  caseType?: CaseType,
): Date | null {
  const fromMeta = stageDeadlineFromMetadata(metadata);
  if (fromMeta) {
    const d = new Date(fromMeta);
    return Number.isNaN(d.getTime()) ? null : startOfLocalDay(d);
  }
  if (!enteredAt.trim()) return null;
  const start = startOfLocalDay(new Date(enteredAt));
  if (Number.isNaN(start.getTime())) return null;
  const termDays = resolveStageTermBusinessDays(stageCode, caseType);
  if (termDays == null) return null;
  return stageDeadlineFromTerm(start, termDays, stageTermCountModeForStage(stageCode));
}

export function metadataForContestacionDeadline(
  notifiedOn: Date,
  caseType?: CaseType,
): Record<string, unknown> {
  const days = resolveStageTermBusinessDays('TERMINO_RESPUESTA', caseType) ?? CONTESTACION_BUSINESS_DAYS;
  const end = stageDeadlineFromTerm(notifiedOn, days, 'following_event');
  return {
    [META_STAGE_DEADLINE_AT]: end.toISOString(),
    [META_STAGE_DEADLINE_KIND]: 'contestacion_accionados' satisfies StageDeadlineKind,
    [META_STAGE_DEADLINE_DAYS]: days,
  };
}

export function metadataForApelacionDeadline(
  notifiedOn: Date,
  caseType?: CaseType,
): Record<string, unknown> {
  const days = resolveStageTermBusinessDays('TERMINO_APELACION', caseType) ?? APELACION_CIVIL_BUSINESS_DAYS;
  const end = stageDeadlineFromTerm(notifiedOn, days, 'following_event');
  return {
    [META_STAGE_DEADLINE_AT]: end.toISOString(),
    [META_STAGE_DEADLINE_KIND]: 'apelacion' satisfies StageDeadlineKind,
    [META_STAGE_DEADLINE_DAYS]: days,
  };
}

export function metadataForExcepcionesDeadline(
  notifiedOn: Date,
  caseType?: CaseType,
): Record<string, unknown> {
  const days = resolveStageTermBusinessDays('TERMINO_EXCEPCIONES', caseType) ?? EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS;
  const end = stageDeadlineFromTerm(notifiedOn, days, 'following_event');
  return {
    [META_STAGE_DEADLINE_AT]: end.toISOString(),
    [META_STAGE_DEADLINE_KIND]: 'excepciones_ejecutivo' satisfies StageDeadlineKind,
    [META_STAGE_DEADLINE_DAYS]: days,
  };
}

export function metadataForImpugnacionDeadline(
  notifiedOn: Date,
  caseType?: CaseType,
): Record<string, unknown> {
  const days = resolveStageTermBusinessDays('TERMINO_IMPUGNACION', caseType) ?? IMPUGNACION_BUSINESS_DAYS;
  const end = stageDeadlineFromTerm(notifiedOn, days, 'following_event');
  return {
    [META_STAGE_DEADLINE_AT]: end.toISOString(),
    [META_STAGE_DEADLINE_KIND]: 'impugnacion' satisfies StageDeadlineKind,
    [META_STAGE_DEADLINE_DAYS]: days,
  };
}

export function subStageDeadlineLabel(stageCode: CaseStageCode, caseType?: CaseType): string | null {
  const days = resolveStageTermBusinessDays(stageCode, caseType);
  if (days == null) return null;
  if (stageCode === 'TERMINO_RESPUESTA') {
    if (caseType && isCivilCaseType(caseType)) {
      return `Contestación de la demanda (${days} días hábiles — CGP art. 369)`;
    }
    return `Contestación de accionados (${days} días hábiles)`;
  }
  if (stageCode === 'TERMINO_IMPUGNACION') {
    return `Impugnación (${days} días háb. siguientes — D. 2591/91 art. 31)`;
  }
  if (stageCode === 'TERMINO_APELACION') {
    return `Apelación (${days} días hábiles — CGP art. 322)`;
  }
  if (stageCode === 'TERMINO_EXCEPCIONES') {
    return `Excepciones de mérito (${days} días hábiles — CGP art. 442)`;
  }
  if (stageCode === 'TRAMITE' && caseType && isCivilCaseType(caseType)) {
    return 'Trámite probatorio y audiencia (CGP)';
  }
  if (days > 0) {
    return `Plazo de etapa (${days} días hábiles)`;
  }
  return null;
}

/** Días hábiles restantes en el tramo [hoy, fin] inclusive; 0 si ya venció. */
export function businessDaysRemainingUntilSubDeadline(end: Date, today = new Date()): number {
  const t = startOfLocalDay(today);
  const e = startOfLocalDay(end);
  if (t.getTime() > e.getTime()) return 0;
  return inclusiveBusinessDaysBetween(t, e);
}
