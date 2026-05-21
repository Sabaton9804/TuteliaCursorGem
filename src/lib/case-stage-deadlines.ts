import {
  CONTESTACION_BUSINESS_DAYS,
  IMPUGNACION_BUSINESS_DAYS,
  contestacionDeadlineFrom,
  impugnacionDeadlineFrom,
  inclusiveBusinessDaysBetween,
  startOfLocalDay,
} from './business-days';
import type { CaseStageCode } from './case-workflow-stages';

export const META_STAGE_DEADLINE_AT = 'stage_deadline_at';
export const META_STAGE_DEADLINE_KIND = 'stage_deadline_kind';
export const META_STAGE_DEADLINE_DAYS = 'stage_deadline_business_days';

export type StageDeadlineKind = 'contestacion_accionados' | 'impugnacion';

export function stageDeadlineFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const v = metadata?.[META_STAGE_DEADLINE_AT];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Plazo secundario de la etapa abierta (contestación 2d / impugnación 3d). */
export function resolveSubStageDeadline(
  stageCode: CaseStageCode,
  enteredAt: string,
  metadata: Record<string, unknown> | null | undefined,
): Date | null {
  const fromMeta = stageDeadlineFromMetadata(metadata);
  if (fromMeta) {
    const d = new Date(fromMeta);
    return Number.isNaN(d.getTime()) ? null : startOfLocalDay(d);
  }
  if (!enteredAt.trim()) return null;
  const start = startOfLocalDay(new Date(enteredAt));
  if (Number.isNaN(start.getTime())) return null;
  if (stageCode === 'TERMINO_RESPUESTA') {
    return contestacionDeadlineFrom(start);
  }
  if (stageCode === 'TERMINO_IMPUGNACION') {
    return impugnacionDeadlineFrom(start);
  }
  return null;
}

export function metadataForContestacionDeadline(notifiedOn: Date): Record<string, unknown> {
  const end = contestacionDeadlineFrom(notifiedOn);
  return {
    [META_STAGE_DEADLINE_AT]: end.toISOString(),
    [META_STAGE_DEADLINE_KIND]: 'contestacion_accionados' satisfies StageDeadlineKind,
    [META_STAGE_DEADLINE_DAYS]: CONTESTACION_BUSINESS_DAYS,
  };
}

export function metadataForImpugnacionDeadline(notifiedOn: Date): Record<string, unknown> {
  const end = impugnacionDeadlineFrom(notifiedOn);
  return {
    [META_STAGE_DEADLINE_AT]: end.toISOString(),
    [META_STAGE_DEADLINE_KIND]: 'impugnacion' satisfies StageDeadlineKind,
    [META_STAGE_DEADLINE_DAYS]: IMPUGNACION_BUSINESS_DAYS,
  };
}

export function subStageDeadlineLabel(stageCode: CaseStageCode): string | null {
  if (stageCode === 'TERMINO_RESPUESTA') {
    return `Contestación de accionados (${CONTESTACION_BUSINESS_DAYS} días hábiles)`;
  }
  if (stageCode === 'TERMINO_IMPUGNACION') {
    return `Impugnación (${IMPUGNACION_BUSINESS_DAYS} días hábiles)`;
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
