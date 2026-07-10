import { parseISO } from 'date-fns';
import type { CaseType } from '../types';
import {
  businessDayTermEnd,
  businessDayTermEndAfterEvent,
  businessDaysRemainingInTermWindow,
  businessDaysRemainingWithStoredTermDeadline,
  inclusiveBusinessDaysBetween,
  startOfLocalDay,
} from './business-days';
import {
  caseTermBusinessDaysFromDecreto2591,
  isTutelaFalloPlazoCaseType,
} from './decreto-2591-plazos';

/** Tutela 1ª: plazo global al radicar. Tutela 2ª: al recibir expediente en despacho (art. 32). */
export function shouldSetPlazoFallarAtRadicacion(caseType?: CaseType): boolean {
  return caseType === 'tutela_primera';
}

/** Calcula `cases.deadline_at` según tipo y fecha ancla del plazo. */
export function computePlazoFallarDeadlineAt(caseType: CaseType, anchorDate: Date): string | null {
  const days = caseTermBusinessDaysFromDecreto2591(caseType);
  if (days == null || days <= 0) return null;
  const day = startOfLocalDay(anchorDate);
  if (caseType === 'tutela_primera') {
    return businessDayTermEnd(day, days).toISOString();
  }
  if (caseType === 'tutela_segunda') {
    return businessDayTermEndAfterEvent(day, days).toISOString();
  }
  return null;
}

function businessDaysRemainingUntilSubDeadline(end: Date, today = new Date()): number {
  const t = startOfLocalDay(today);
  const e = startOfLocalDay(end);
  if (t.getTime() > e.getTime()) return 0;
  return inclusiveBusinessDaysBetween(t, e);
}

export type PlazoFallarSnapshot = {
  remaining: number;
  end: Date | null;
  termDays: number;
  anchorLabel: 'radicación' | 'recepción del expediente';
  pendingAnchor: boolean;
};

export function plazoFallarSnapshotForCase(
  caseItem: { caseType?: CaseType; createdAt: string; deadlineAt?: string },
  today = new Date(),
): PlazoFallarSnapshot | null {
  const caseType = caseItem.caseType ?? 'tutela_primera';
  if (!isTutelaFalloPlazoCaseType(caseType)) return null;
  const termDays = caseTermBusinessDaysFromDecreto2591(caseType);
  if (termDays == null || termDays <= 0) return null;

  const dlRaw = caseItem.deadlineAt?.trim();

  if (caseType === 'tutela_segunda') {
    if (!dlRaw) {
      return {
        remaining: termDays,
        end: null,
        termDays,
        anchorLabel: 'recepción del expediente',
        pendingAnchor: true,
      };
    }
    const end = startOfLocalDay(parseISO(dlRaw));
    if (Number.isNaN(end.getTime())) return null;
    return {
      remaining: businessDaysRemainingUntilSubDeadline(end, today),
      end,
      termDays,
      anchorLabel: 'recepción del expediente',
      pendingAnchor: false,
    };
  }

  const filed = caseItem.createdAt?.trim();
  if (!filed) return null;
  const filing = startOfLocalDay(parseISO(filed));
  if (Number.isNaN(filing.getTime())) return null;
  const end = dlRaw
    ? startOfLocalDay(parseISO(dlRaw))
    : businessDayTermEnd(filing, termDays);
  if (Number.isNaN(end.getTime())) return null;
  const remaining = dlRaw
    ? businessDaysRemainingWithStoredTermDeadline(filing, end, termDays, today)
    : businessDaysRemainingInTermWindow(filing, termDays, today);

  return {
    remaining,
    end,
    termDays,
    anchorLabel: 'radicación',
    pendingAnchor: false,
  };
}
