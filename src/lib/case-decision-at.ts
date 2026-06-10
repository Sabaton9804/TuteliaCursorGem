import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DecisionType } from '../types';
import { DECRETO_2591_LABEL } from './decreto-2591-plazos';

/** Convierte input type="date" (calendario local) a ISO con mediodía local (evita saltos de día por UTC). */
export function decisionAtIsoFromDateInput(dateStr: string): string | null {
  const raw = dateStr.trim();
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const local = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (!Number.isFinite(local.getTime())) return null;
  return local.toISOString();
}

export function decisionDateInputFromIso(iso: string | undefined): string {
  if (!iso?.trim()) return '';
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return '';
  return format(parsed, 'yyyy-MM-dd');
}

export function formatDecisionAtDisplay(iso: string | undefined): string | null {
  if (!iso?.trim()) return null;
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return null;
  return format(parsed, "EEEE d 'de' MMMM yyyy", { locale: es });
}

/** Payload Supabase al registrar o ajustar decisión (SIERJU usa decision_at, no updated_at). */
export function buildCaseDecisionUpdate(opts: {
  decisionType: DecisionType | undefined;
  decisionAtIso: string | null;
  nowIso?: string;
}): {
  decision_type: DecisionType | null;
  decision_at: string | null;
  updated_at: string;
} {
  const now = opts.nowIso ?? new Date().toISOString();
  const type = opts.decisionType ?? null;
  return {
    decision_type: type,
    decision_at: type ? opts.decisionAtIso : null,
    updated_at: now,
  };
}

export const DECISION_AT_FIELD_HINT =
  `Fecha de la decisión sustantiva para estadística SIERJU (${DECRETO_2591_LABEL}). Distinta del «último cambio» del expediente.`;
