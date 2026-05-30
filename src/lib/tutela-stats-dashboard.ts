/**
 * Métricas analíticas del tablero de estadísticas de tutelas (gráficos, tiempos, estados).
 */

import {
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { Case, CaseStatus } from '../types';
import {
  buildExpedienteViewRow,
  BOARD_STAGE_ORDER,
  stageLabel,
  type BoardStage,
} from './expedientes-view-model';
import { DECISION_TYPE_LABELS, type DecisionType } from './sierju-case-codes';
import {
  buildTutelaInforme,
  decisionEffectiveAt,
  filterCasesForTutelaStats,
  inDateRange,
  type TutelaStatsScope,
} from './sierju-tutela-informe';

export type StatsTimeGranularity = 'week' | 'month';

export type StatsTimePoint = {
  key: string;
  label: string;
  ingresos: number;
  salidas: number;
};

export type StatsChartRow = {
  key: string;
  label: string;
  value: number;
  color?: string;
};

export type TutelaStatsDashboard = {
  informe: ReturnType<typeof buildTutelaInforme>;
  timeSeries: StatsTimePoint[];
  statusCounts: StatsChartRow[];
  stageCounts: StatsChartRow[];
  topDerechosIngreso: StatsChartRow[];
  topDecisiones: StatsChartRow[];
  termBuckets: {
    vencidos: number;
    urgentes: number;
    alerta: number;
    enTermino: number;
    cerrados: number;
  };
  tiemposFallo: {
    promedioDias: number | null;
    medianaDias: number | null;
    muestra: number;
  };
  tasaConcesion: number | null;
  sinClasificar: number;
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  received: 'Recibido',
  admitted: 'Admitido',
  transfer: 'Traslado',
  judgment: 'Fallo',
  archived: 'Archivado',
};

const STATUS_COLORS: Record<CaseStatus, string> = {
  received: '#64748b',
  admitted: '#2563eb',
  transfer: '#059669',
  judgment: '#7c3aed',
  archived: '#94a3b8',
};

const STAGE_COLORS: Record<BoardStage, string> = {
  radicado: '#64748b',
  admitido: '#2563eb',
  esp_respuesta: '#059669',
  en_analisis: '#d97706',
  fallo_redactado: '#7c3aed',
  fallo_notificado: '#e11d48',
  archivado: '#94a3b8',
};

const DECISION_COLORS: Partial<Record<DecisionType, string>> = {
  CONCEDE: '#059669',
  NIEGA: '#dc2626',
  IMPROCEDENTE: '#64748b',
  HECHO_SUPERADO: '#0891b2',
  RECHAZA: '#b45309',
  FALTA_COMPETENCIA: '#6366f1',
};

function daysBetween(startIso: string, endIso: string): number | null {
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function buildTimeSeries(
  cases: readonly Case[],
  from: Date,
  to: Date,
  scope: TutelaStatsScope,
  granularity: StatsTimeGranularity,
): StatsTimePoint[] {
  const filtered = filterCasesForTutelaStats(cases, scope);
  const intervals =
    granularity === 'month'
      ? eachMonthOfInterval({ start: from, end: to })
      : eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 1 });

  return intervals.map((start) => {
    const end =
      granularity === 'month'
        ? endOfMonth(start)
        : endOfWeek(start, { weekStartsOn: 1 });
    const bucketFrom = start < from ? from : start;
    const bucketTo = end > to ? to : end;
    let ingresos = 0;
    let salidas = 0;
    for (const c of filtered) {
      if (inDateRange(c.createdAt, bucketFrom, bucketTo)) ingresos += 1;
      const at = decisionEffectiveAt(c);
      if (c.decisionType && inDateRange(at, bucketFrom, bucketTo)) salidas += 1;
    }
    const label =
      granularity === 'month'
        ? format(start, 'MMM yy', { locale: es })
        : format(start, 'd MMM', { locale: es });
    return {
      key: format(start, granularity === 'month' ? 'yyyy-MM' : 'yyyy-ww'),
      label,
      ingresos,
      salidas,
    };
  });
}

export function buildTutelaStatsDashboard(
  cases: readonly Case[],
  from: Date,
  to: Date,
  scope: TutelaStatsScope,
  granularity: StatsTimeGranularity = 'month',
): TutelaStatsDashboard {
  const informe = buildTutelaInforme(cases, from, to, scope);
  const scoped = filterCasesForTutelaStats(cases, scope);
  const activos = scoped.filter((c) => c.status !== 'archived');

  const statusMap = new Map<CaseStatus, number>();
  for (const c of activos) {
    statusMap.set(c.status, (statusMap.get(c.status) ?? 0) + 1);
  }
  const statusCounts: StatsChartRow[] = (Object.keys(STATUS_LABELS) as CaseStatus[])
    .map((status) => ({
      key: status,
      label: STATUS_LABELS[status],
      value: statusMap.get(status) ?? 0,
      color: STATUS_COLORS[status],
    }))
    .filter((r) => r.value > 0);

  const stageMap = new Map<BoardStage, number>();
  for (const c of scoped) {
    const stage = buildExpedienteViewRow(c).stage;
    stageMap.set(stage, (stageMap.get(stage) ?? 0) + 1);
  }
  const stageCounts: StatsChartRow[] = BOARD_STAGE_ORDER.map((stage) => ({
    key: stage,
    label: stageLabel(stage),
    value: stageMap.get(stage) ?? 0,
    color: STAGE_COLORS[stage],
  })).filter((r) => r.value > 0);

  let vencidos = 0;
  let urgentes = 0;
  let alerta = 0;
  let enTermino = 0;
  let cerrados = 0;
  for (const c of scoped) {
    const row = buildExpedienteViewRow(c);
    if (row.stage === 'archivado' || row.stage === 'fallo_notificado') {
      cerrados += 1;
      continue;
    }
    if (row.businessDaysRemaining <= 0) vencidos += 1;
    else if (row.urgency === 'urgent') urgentes += 1;
    else if (row.urgency === 'warn') alerta += 1;
    else enTermino += 1;
  }

  const diasFallo: number[] = [];
  for (const c of scoped) {
    if (!c.decisionType) continue;
    const at = decisionEffectiveAt(c);
    if (!at) continue;
    const d = daysBetween(c.createdAt, at);
    if (d != null) diasFallo.push(d);
  }

  const concede = informe.porDecisionSalida.find((r) => r.key === 'CONCEDE')?.count ?? 0;
  const sustantivas = informe.porDecisionSalida
    .filter((r) => r.key === 'CONCEDE' || r.key === 'NIEGA')
    .reduce((s, r) => s + r.count, 0);

  const topDerechosIngreso = [...informe.porDerechoIngreso]
    .filter((r) => r.count > 0 && r.key !== '__SIN_CLASIFICAR__')
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((r) => ({ key: r.key, label: r.label, value: r.count, color: '#0d9488' }));

  const topDecisiones = informe.porDecisionSalida
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      key: r.key,
      label: DECISION_TYPE_LABELS[r.key],
      value: r.count,
      color: DECISION_COLORS[r.key] ?? '#64748b',
    }));

  return {
    informe,
    timeSeries: buildTimeSeries(cases, from, to, scope, granularity),
    statusCounts,
    stageCounts,
    topDerechosIngreso,
    topDecisiones,
    termBuckets: { vencidos, urgentes, alerta, enTermino, cerrados },
    tiemposFallo: {
      promedioDias: diasFallo.length
        ? Math.round(diasFallo.reduce((s, d) => s + d, 0) / diasFallo.length)
        : null,
      medianaDias: median(diasFallo) != null ? Math.round(median(diasFallo)!) : null,
      muestra: diasFallo.length,
    },
    tasaConcesion: sustantivas > 0 ? Math.round((concede / sustantivas) * 100) : null,
    sinClasificar: informe.porDerechoIngreso.find((r) => r.key === '__SIN_CLASIFICAR__')?.count ?? 0,
  };
}

export function maxChartValue(rows: readonly { value: number }[], min = 1): number {
  return Math.max(min, ...rows.map((r) => r.value));
}
