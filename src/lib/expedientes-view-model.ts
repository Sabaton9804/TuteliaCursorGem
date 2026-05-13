import type { Case, CaseStatus, SustanciadorAssignmentMode } from '../types';
import {
  businessDaysRemainingInTenDayWindow,
  businessDaysRemainingWithStoredDeadline,
  startOfLocalDay,
  tenthBusinessDayDeadline,
} from './business-days';
import { DERECHO_TUTELADO_LABELS, resolveDerechoTuteladoCodeForInforme } from './sierju-case-codes';
import type { ExpedienteAssignee } from './court-staff-assignees';
import { resolveAssigneeForCase } from './court-staff-assignees';

export type { ExpedienteAssignee } from './court-staff-assignees';

/** Columnas del tablero (alineadas al flujo operativo). */
export type BoardStage =
  | 'radicado'
  | 'admitido'
  | 'esp_respuesta'
  | 'en_analisis'
  | 'fallo_redactado'
  | 'fallo_notificado'
  | 'archivado';

export type UrgencyLevel = 'urgent' | 'warn' | 'ok' | 'neutral';

const DERECHO_UI_MAX = 72;

/**
 * Texto del derecho tutelado para listas y tablero: usa `derecho_tutelado_code` si está guardado;
 * si no, intenta el mismo criterio que los informes (artículo CP o palabras clave en el texto libre)
 * y muestra la etiqueta SIERJU; solo si no hay clasificación posible, el texto libre truncado.
 */
export function derechoTuteladoDisplay(c: Case): string {
  const raw = c.legalDerechoTutelado?.replace(/\s+/g, ' ').trim();
  const code = c.derechoTuteladoCode ?? resolveDerechoTuteladoCodeForInforme(c);
  if (code) {
    const label = DERECHO_TUTELADO_LABELS[code];
    if (code === 'OTROS' && raw) {
      const snippet = raw.length <= DERECHO_UI_MAX ? raw : `${raw.slice(0, DERECHO_UI_MAX - 1)}…`;
      return `${label}: ${snippet}`;
    }
    return label;
  }
  if (!raw) return 'Sin indicar';
  if (raw.length <= DERECHO_UI_MAX) return raw;
  return `${raw.slice(0, DERECHO_UI_MAX - 1)}…`;
}

function normOp(s?: string): string {
  return (s || '').toLowerCase();
}

export function caseToBoardStage(c: Case): BoardStage {
  const op = normOp(c.operationalStatus);
  if (c.status === 'archived') return 'archivado';
  if (c.status === 'judgment') {
    if (op.includes('notif') || op.includes('notificado')) return 'fallo_notificado';
    return 'fallo_redactado';
  }
  if (c.status === 'transfer') return 'esp_respuesta';
  if (c.status === 'admitted') {
    if (op.includes('respuesta') || op.includes('traslado') || op.includes('esp')) return 'esp_respuesta';
    if (op.includes('anal') || op.includes('estudio')) return 'en_analisis';
    return 'admitido';
  }
  return 'radicado';
}

export function stageLabel(s: BoardStage): string {
  const m: Record<BoardStage, string> = {
    radicado: 'Radicado',
    admitido: 'Admitido',
    esp_respuesta: 'Términos',
    en_analisis: 'En análisis',
    fallo_redactado: 'Fallo redactado',
    fallo_notificado: 'Fallo notificado',
    archivado: 'Archivado',
  };
  return m[s];
}

export function statusBadgeForStage(s: BoardStage): string {
  switch (s) {
    case 'radicado':
      return 'bg-slate-50 text-slate-600 border-slate-200';
    case 'admitido':
      return 'bg-blue-50 text-blue-800 border-blue-100';
    case 'esp_respuesta':
      return 'bg-emerald-50 text-emerald-800 border-emerald-100';
    case 'en_analisis':
      return 'bg-amber-50 text-amber-900 border-amber-100';
    case 'fallo_redactado':
      return 'bg-violet-50 text-violet-800 border-violet-100';
    case 'fallo_notificado':
      return 'bg-rose-50 text-rose-800 border-rose-100';
    case 'archivado':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

export function urgencyFromRemainingBusinessDays(
  remaining: number,
  status: CaseStatus,
  stage: BoardStage
): UrgencyLevel {
  if (stage === 'archivado' || status === 'archived') return 'neutral';
  if (stage === 'fallo_notificado') return 'neutral';
  if (remaining <= 0) return 'urgent';
  if (remaining <= 2) return 'urgent';
  if (remaining <= 4) return 'warn';
  return 'ok';
}

export interface ExpedienteViewRow {
  case: Case;
  stage: BoardStage;
  assignee: ExpedienteAssignee;
  derechoTag: string;
  /** Días hábiles restantes del término de 10 desde radicación (puede ser ≤0). */
  businessDaysRemaining: number;
  urgency: UrgencyLevel;
  filingDate: Date;
  deadlineDate: Date;
  /** 0–100 para barra de avance del término. */
  termProgressPercent: number;
}

export function buildExpedienteViewRow(
  c: Case,
  courtAssignmentMode?: SustanciadorAssignmentMode | null
): ExpedienteViewRow {
  const filingDate = startOfLocalDay(new Date(c.createdAt));
  const storedDeadline =
    c.deadlineAt?.trim() && !Number.isNaN(Date.parse(c.deadlineAt))
      ? startOfLocalDay(new Date(c.deadlineAt))
      : null;
  const deadlineDate = storedDeadline ?? tenthBusinessDayDeadline(filingDate);
  const remaining = storedDeadline
    ? businessDaysRemainingWithStoredDeadline(filingDate, storedDeadline)
    : businessDaysRemainingInTenDayWindow(filingDate);
  const stage = caseToBoardStage(c);
  const urgency = urgencyFromRemainingBusinessDays(remaining, c.status, stage);
  const assignee = resolveAssigneeForCase(c.assignedTo, c.id, courtAssignmentMode);
  const derechoTag = derechoTuteladoDisplay(c);

  let termProgressPercent = Math.min(
    100,
    Math.max(0, ((10 - Math.max(0, remaining)) / 10) * 100)
  );
  if (stage === 'archivado' || stage === 'fallo_notificado') {
    termProgressPercent = 100;
  }

  return {
    case: c,
    stage,
    assignee,
    derechoTag,
    businessDaysRemaining: remaining,
    urgency,
    filingDate,
    deadlineDate,
    termProgressPercent,
  };
}

export const BOARD_STAGE_ORDER: BoardStage[] = [
  'radicado',
  'admitido',
  'esp_respuesta',
  'en_analisis',
  'fallo_redactado',
  'fallo_notificado',
  'archivado',
];
