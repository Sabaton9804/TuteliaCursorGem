/**
 * Agregados borrador para la hoja SIERJU «Movimiento de Tutelas» (primera instancia).
 */

import type { Case, CaseType } from '../types';
import {
  DERECHO_TUTELADO_CODES,
  DERECHO_TUTELADO_LABELS,
  DECISION_TYPE_LABELS,
  DECISION_TYPES,
  type DecisionType,
  type DerechoTuteladoCode,
  resolveDerechoTuteladoCodeForInforme,
} from './sierju-case-codes';
import { fundamentalToDerecho } from './sierju-code-bridge';
import type { FundamentalRightCode } from './sierju-types';

/** Hoja movimiento_tutelas aplica a tutelas de primera instancia radicadas en el despacho. */
export const TUTELA_PRIMERA_CASE_TYPE: CaseType = 'tutela_primera';

export const TUTELA_STATS_CASE_TYPES: readonly CaseType[] = [
  'tutela_primera',
  'tutela_segunda',
  'consulta_desacato',
] as const;

export type TutelaStatsScope = 'primera' | 'todas_tutelas';

export function filterCasesForTutelaStats(
  cases: readonly Case[],
  scope: TutelaStatsScope,
): Case[] {
  if (scope === 'primera') {
    return cases.filter((c) => (c.caseType ?? TUTELA_PRIMERA_CASE_TYPE) === TUTELA_PRIMERA_CASE_TYPE);
  }
  return cases.filter((c) =>
    TUTELA_STATS_CASE_TYPES.includes(c.caseType ?? TUTELA_PRIMERA_CASE_TYPE),
  );
}

export type TutelaRowKey = DerechoTuteladoCode | '__SIN_CLASIFICAR__';

/** Mapeo decision_type (app) → código movimiento salida SIERJU tutela. */
export const DECISION_TO_TUTELA_SALIDA: Record<DecisionType, string> = {
  CONCEDE: 'tutela_salida_concede',
  NIEGA: 'tutela_salida_niega',
  IMPROCEDENTE: 'tutela_salida_improcedente',
  HECHO_SUPERADO: 'tutela_salida_hecho_superado',
  RECHAZA: 'tutela_salida_rechaza',
  FALTA_COMPETENCIA: 'tutela_salida_falta_competencia',
  RETIRO_VOLUNTARIO: 'tutela_salida_retiro_voluntario',
  REMISION: 'tutela_salida_conocimiento_previo',
  OTRAS: 'tutela_salida_otras_no_efectivas',
};

/** Salidas SIERJU sin decision_type en app (pendiente S3 / eventos). */
export const TUTELA_SALIDAS_SIN_MODELO_APP: readonly { code: string; label: string }[] = [
  { code: 'tutela_salida_impedimentos', label: 'SALIDA IMPEDIMENTOS' },
];

export function resolveTutelaRowKey(c: Case): TutelaRowKey {
  const fromMeta = c.sierjuMetadata?.fundamental_right;
  if (fromMeta) {
    return fundamentalToDerecho(fromMeta);
  }
  if (c.derechoTuteladoCode) return c.derechoTuteladoCode;
  return resolveDerechoTuteladoCodeForInforme(c) ?? '__SIN_CLASIFICAR__';
}

export function decisionEffectiveAt(c: Case): string | undefined {
  return c.decisionAt ?? (c.decisionType ? c.updatedAt : undefined);
}

export function inDateRange(iso: string | undefined, from: Date, to: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  return d >= from && d <= to;
}

export type TutelaInforme = {
  scope: TutelaStatsScope;
  ingresosCount: number;
  salidasCount: number;
  activos: number;
  totalExpedientes: number;
  conClaseSierju: number;
  conCodigoExplicito: number;
  conDerechoIdentificable: number;
  conDecisionAtExplicito: number;
  porDerechoIngreso: Array<{ key: TutelaRowKey; label: string; count: number }>;
  porDecisionSalida: Array<{ key: DecisionType; label: string; count: number; sierjuCode: string }>;
  matrizSalida: Array<{
    rowKey: TutelaRowKey;
    rowLabel: string;
    cells: Array<{ decision: DecisionType; label: string; count: number }>;
    total: number;
  }>;
};

function emptyRowCounts(): Map<TutelaRowKey, number> {
  const m = new Map<TutelaRowKey, number>();
  for (const code of DERECHO_TUTELADO_CODES) m.set(code, 0);
  m.set('__SIN_CLASIFICAR__', 0);
  return m;
}

export function buildTutelaInforme(
  allCases: readonly Case[],
  from: Date,
  to: Date,
  scope: TutelaStatsScope,
): TutelaInforme {
  const cases = filterCasesForTutelaStats(allCases, scope);

  const ingresosPorDerecho = emptyRowCounts();
  let ingresosCount = 0;
  for (const c of cases) {
    if (!inDateRange(c.createdAt, from, to)) continue;
    ingresosCount += 1;
    const row = resolveTutelaRowKey(c);
    ingresosPorDerecho.set(row, (ingresosPorDerecho.get(row) ?? 0) + 1);
  }

  const salidasPorDecision = new Map<DecisionType, number>();
  for (const dt of DECISION_TYPES) salidasPorDecision.set(dt, 0);

  const matriz = new Map<TutelaRowKey, Map<DecisionType, number>>();
  for (const row of [...DERECHO_TUTELADO_CODES, '__SIN_CLASIFICAR__' as TutelaRowKey]) {
    const inner = new Map<DecisionType, number>();
    for (const dt of DECISION_TYPES) inner.set(dt, 0);
    matriz.set(row, inner);
  }

  let salidasCount = 0;
  let conDecisionAtExplicito = 0;
  for (const c of cases) {
    if (!c.decisionType) continue;
    const at = decisionEffectiveAt(c);
    if (!inDateRange(at, from, to)) continue;
    salidasCount += 1;
    if (c.decisionAt) conDecisionAtExplicito += 1;
    salidasPorDecision.set(c.decisionType, (salidasPorDecision.get(c.decisionType) ?? 0) + 1);
    const row = resolveTutelaRowKey(c);
    const rowMap = matriz.get(row)!;
    rowMap.set(c.decisionType, (rowMap.get(c.decisionType) ?? 0) + 1);
  }

  const activos = cases.filter((c) => c.status !== 'archived').length;
  const conClaseSierju = cases.filter((c) => Boolean(c.sierjuProcessClassId)).length;
  const conCodigoExplicito = cases.filter((c) => Boolean(c.derechoTuteladoCode)).length;
  const conDerechoIdentificable = cases.filter((c) => resolveTutelaRowKey(c) !== '__SIN_CLASIFICAR__').length;

  return {
    scope,
    ingresosCount,
    salidasCount,
    activos,
    totalExpedientes: cases.length,
    conClaseSierju,
    conCodigoExplicito,
    conDerechoIdentificable,
    conDecisionAtExplicito,
    porDerechoIngreso: [
      ...DERECHO_TUTELADO_CODES.map((code) => ({
        key: code as TutelaRowKey,
        label: DERECHO_TUTELADO_LABELS[code],
        count: ingresosPorDerecho.get(code) ?? 0,
      })),
      {
        key: '__SIN_CLASIFICAR__' as TutelaRowKey,
        label: 'Sin clasificar',
        count: ingresosPorDerecho.get('__SIN_CLASIFICAR__') ?? 0,
      },
    ],
    porDecisionSalida: DECISION_TYPES.map((dt) => ({
      key: dt,
      label: DECISION_TYPE_LABELS[dt],
      count: salidasPorDecision.get(dt) ?? 0,
      sierjuCode: DECISION_TO_TUTELA_SALIDA[dt],
    })).filter((row) => row.count > 0),
    matrizSalida: [...DERECHO_TUTELADO_CODES, '__SIN_CLASIFICAR__' as TutelaRowKey]
      .map((rowKey) => {
        const rowMap = matriz.get(rowKey)!;
        const cells = DECISION_TYPES.map((decision) => ({
          decision,
          label: DECISION_TYPE_LABELS[decision],
          count: rowMap.get(decision) ?? 0,
        })).filter((cell) => cell.count > 0);
        const total = cells.reduce((s, c) => s + c.count, 0);
        return {
          rowKey,
          rowLabel:
            rowKey === '__SIN_CLASIFICAR__'
              ? 'Sin clasificar'
              : DERECHO_TUTELADO_LABELS[rowKey],
          cells,
          total,
        };
      })
      .filter((row) => row.total > 0),
  };
}

export const SIERJU_TUTELAS_COBERTURA: readonly {
  bloque: string;
  detalle: string;
  estado: 'si' | 'parcial' | 'no';
}[] = [
  {
    bloque: 'Filas por derecho tutelado (12 filas SIERJU)',
    detalle:
      'Catálogo S1 + selector S2; informe usa sierju_process_class_id, derecho_tutelado_code o texto CP.',
    estado: 'si',
  },
  {
    bloque: 'Ingreso por reparto en el periodo',
    detalle: 'Tutelas de 1ª instancia con created_at en el periodo (proxy de tutela_entrada_reparto).',
    estado: 'parcial',
  },
  {
    bloque: 'Salidas sustantivas (CONCEDE, NIEGA, IMPROCEDENTE, …)',
    detalle:
      'decision_type mapeado a tutela_salida_*; fecha con decision_at (o updated_at si es histórico).',
    estado: 'parcial',
  },
  {
    bloque: 'Matriz fila (derecho) × columna (tipo de decisión)',
    detalle: 'Tabla cruzada en Informe estadístico para el periodo seleccionado.',
    estado: 'parcial',
  },
  {
    bloque: 'Inventario al iniciar / finalizar el periodo',
    detalle: 'Requiere case_sierju_events o snapshots (Fase S3).',
    estado: 'no',
  },
  {
    bloque: 'Reingreso, competencia, impedimentos (entradas)',
    detalle: 'Sin tipos de entrada separados; Fase S3 con eventos.',
    estado: 'no',
  },
  {
    bloque: 'Salida impedimentos',
    detalle: 'No hay decision_type; solo en catálogo sierju_movement_types.',
    estado: 'no',
  },
  {
    bloque: 'Procesos acumulados',
    detalle: 'Sin regla ni campo de acumulación.',
    estado: 'no',
  },
  {
    bloque: 'Incidentes de desacato / impugnaciones / consultas',
    detalle: 'Hojas aparte del formulario; no incluidas en este informe de tutelas 1ª.',
    estado: 'no',
  },
  {
    bloque: 'Export Excel oficial CSJ',
    detalle: 'Fase S4.',
    estado: 'no',
  },
];

export function rowKeyFromFundamental(code: FundamentalRightCode): DerechoTuteladoCode {
  return fundamentalToDerecho(code);
}
