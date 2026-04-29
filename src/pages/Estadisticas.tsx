import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import {
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { rowToCase } from '../lib/supabase-mappers';
import type { Case } from '../types';
import {
  DERECHO_TUTELADO_CODES,
  DERECHO_TUTELADO_LABELS,
  DECISION_TYPE_LABELS,
  DECISION_TYPES,
  resolveDerechoTuteladoCodeForInforme,
} from '../lib/sierju-case-codes';

const COURT_ID = 'court-1';

/**
 * Bloques del Excel «Movimiento de Tutelas» (SIERJU) vs esta pantalla.
 * Prioridad del producto: admisión; completar columnas del formulario oficial será iterativo después.
 */
const SIERJU_TUTELAS_COBERTURA: readonly {
  bloque: string;
  detalle: string;
  estado: 'si' | 'parcial' | 'no';
}[] = [
  {
    bloque: 'Filas por derecho tutelado (SALUD, Debido proceso, etc.)',
    detalle: 'Misma taxonomía de filas del formulario.',
    estado: 'si',
  },
  {
    bloque: 'Inventario al iniciar el periodo (por derecho)',
    detalle: 'Requiere stock al corte o historial de cada expediente; no se calcula aún.',
    estado: 'no',
  },
  {
    bloque: 'Ingreso por reparto en el periodo',
    detalle: 'Se aproxima con tutelas creadas en el periodo (fecha de radicación en el sistema).',
    estado: 'parcial',
  },
  {
    bloque: 'Reingreso por nulidad o competencia / Ingreso por competencia',
    detalle: 'No hay tipos de entrada separados en base de datos.',
    estado: 'no',
  },
  {
    bloque: 'Entrada impedimentos / Otras entradas no efectivas',
    detalle: 'No registrados como hechos contables.',
    estado: 'no',
  },
  {
    bloque: 'Salidas: CONCEDE, NIEGA, IMPROCEDENTE, FALTA DE COMPETENCIA, etc.',
    detalle: 'Solo lo que coincida con `decision_type` y fecha proxy (`updated_at`); faltan impedimentos, remisión explícita, etc.',
    estado: 'parcial',
  },
  {
    bloque: 'Salida impedimentos / Hecho superado / Rechazo / Remisión / Retiro / Otras salidas',
    detalle: 'Parte cabe en `decision_type`; el resto no está modelado por separado.',
    estado: 'parcial',
  },
  {
    bloque: 'Procesos acumulados',
    detalle: 'No hay campo ni regla de acumulación en el sistema.',
    estado: 'no',
  },
  {
    bloque: 'Inventario al finalizar el periodo (por derecho)',
    detalle: 'Mismo cuello de botella que el inventario inicial.',
    estado: 'no',
  },
  {
    bloque: 'Columna «Derechos fundamentales tutelados» (si aplica en su versión del formulario)',
    detalle: 'No replicada; solo clasificación por fila SIERJU y texto libre.',
    estado: 'no',
  },
];

type PeriodPreset = 'week' | 'month' | 'quarter' | 'year' | 'last30' | 'custom';

function rangeForPreset(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string
): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case 'week':
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfWeek(now, { weekStartsOn: 1 }),
      };
    case 'month':
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'quarter':
      return { from: startOfQuarter(now), to: endOfQuarter(now) };
    case 'year':
      return { from: startOfYear(now), to: endOfYear(now) };
    case 'last30':
      return { from: subDays(now, 30), to: now };
    case 'custom': {
      const a = new Date(`${customFrom}T00:00:00`);
      const b = new Date(`${customTo}T23:59:59.999`);
      if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) {
        return { from: startOfMonth(now), to: endOfMonth(now) };
      }
      return { from: a, to: b };
    }
    default:
      return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

function inRange(iso: string, from: Date, to: Date): boolean {
  const d = new Date(iso);
  return d >= from && d <= to;
}

export default function Estadisticas() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('cases')
      .select(
        'id,created_at,updated_at,status,derecho_tutelado_code,decision_type,legal_derecho_tutelado,radicado,court_id'
      )
      .eq('court_id', COURT_ID);
    if (fetchError) {
      setError(fetchError.message);
      setCases([]);
      setLoading(false);
      return;
    }
    setCases((data || []).map((r) => rowToCase(r as Record<string, unknown>)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { from, to } = useMemo(
    () => rangeForPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const informe = useMemo(() => {
    const ingresos = cases.filter((c) => inRange(c.createdAt, from, to));
    const porDerecho = new Map<string, number>();
    for (const code of DERECHO_TUTELADO_CODES) porDerecho.set(code, 0);
    porDerecho.set('__SIN_CLASIFICAR__', 0);
    for (const c of ingresos) {
      const resolved = resolveDerechoTuteladoCodeForInforme(c);
      const k = resolved ?? '__SIN_CLASIFICAR__';
      porDerecho.set(k, (porDerecho.get(k) ?? 0) + 1);
    }

    const decisionesPeriodo = cases.filter(
      (c) => c.decisionType && inRange(c.updatedAt, from, to)
    );
    const porDecision = new Map<string, number>();
    for (const dt of DECISION_TYPES) porDecision.set(dt, 0);
    for (const c of decisionesPeriodo) {
      if (!c.decisionType) continue;
      porDecision.set(c.decisionType, (porDecision.get(c.decisionType) ?? 0) + 1);
    }

    const activos = cases.filter((c) => c.status !== 'archived').length;
    const conCodigoExplicito = cases.filter((c) => Boolean(c.derechoTuteladoCode)).length;
    const conDerechoIdentificable = cases.filter((c) => Boolean(resolveDerechoTuteladoCodeForInforme(c))).length;

    return {
      ingresosCount: ingresos.length,
      porDerechoRows: [
        ...DERECHO_TUTELADO_CODES.map((code) => ({
          key: code,
          label: DERECHO_TUTELADO_LABELS[code],
          count: porDerecho.get(code) ?? 0,
        })),
        {
          key: '__SIN_CLASIFICAR__',
          label: 'Sin clasificar',
          count: porDerecho.get('__SIN_CLASIFICAR__') ?? 0,
        },
      ],
      decisionesCount: decisionesPeriodo.length,
      porDecisionRows: DECISION_TYPES.map((dt) => ({
        key: dt,
        label: DECISION_TYPE_LABELS[dt],
        count: porDecision.get(dt) ?? 0,
      })).filter((row) => row.count > 0),
      totalExpedientes: cases.length,
      activos,
      conCodigoExplicito,
      conDerechoIdentificable,
    };
  }, [cases, from, to]);

  const periodoLabel = `${format(from, "d MMM yyyy", { locale: es })} — ${format(to, "d MMM yyyy", { locale: es })}`;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <BarChart3 className="h-4 w-4 text-accent" aria-hidden />
            Despacho
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Informe estadístico</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
            Por ahora el foco del desarrollo es la admisión; esta vista solo anticipa totales útiles (ingresos por periodo,
            derecho tutelado, decisiones). El formulario completo de la Rama tiene más columnas; la tabla del final es la hoja
            de ruta para cuando avancemos el flujo y los datos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Actualizar datos
        </button>
      </header>

      <div className="card-modern border border-slate-100 p-5 sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Periodo</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(
            [
              ['week', 'Esta semana'],
              ['month', 'Este mes'],
              ['quarter', 'Este trimestre'],
              ['year', 'Este año'],
              ['last30', 'Últimos 30 días'],
              ['custom', 'Personalizado'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreset(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                preset === key
                  ? 'bg-accent text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Desde
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="input-modern rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Hasta
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="input-modern rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
        ) : null}
        <p className="mt-4 text-sm font-medium text-slate-600">{periodoLabel}</p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      ) : null}

      {loading && cases.length === 0 ? (
        <div className="card-modern flex items-center justify-center gap-2 p-12 text-sm font-medium text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando expedientes…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card-modern border border-slate-100 p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tutelas radicadas (periodo)</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{informe.ingresosCount}</p>
              <p className="mt-1 text-xs text-slate-500">Por fecha de creación en el sistema.</p>
            </div>
            <div className="card-modern border border-slate-100 p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Expedientes activos (total)</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{informe.activos}</p>
              <p className="mt-1 text-xs text-slate-500">Estado distinto de archivado.</p>
            </div>
            <div className="card-modern border border-slate-100 p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Clasificación usable</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {informe.conDerechoIdentificable}
                <span className="text-lg font-semibold text-slate-400">
                  {' '}
                  / {informe.totalExpedientes}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Código en BD o derecho reconocido desde el texto (Art. CP). Explícito en BD: {informe.conCodigoExplicito}.
              </p>
            </div>
          </div>

          <div className="card-modern overflow-hidden border border-slate-100">
            <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-800">Ingresos en el periodo por derecho tutelado</h2>
              <p className="text-xs text-slate-500">
                Solo tutelas radicadas en el periodo. Si no hay código SIERJU guardado, se deduce del texto del expediente (por
                ejemplo «Art. 29 — Debido proceso»), igual que lo que ve en la lista de expedientes.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Derecho tutelado
                    </th>
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {informe.porDerechoRows.map((row) => (
                    <tr key={row.key} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-800">{row.label}</td>
                      <td className="px-5 py-3 tabular-nums text-slate-700">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-modern overflow-hidden border border-slate-100">
            <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-800">Decisiones registradas en el periodo</h2>
              <p className="text-xs text-slate-500">
                Expedientes con tipo de decisión cuya última actualización cae en el periodo ({informe.decisionesCount}{' '}
                movimientos). Útil como proxy hasta tener fecha propia de fallo.
              </p>
            </div>
            {informe.porDecisionRows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No hay decisiones con fecha de actualización en este periodo. Registre el tipo de decisión al cerrar
                fallos o archive en cada expediente.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo</th>
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {informe.porDecisionRows.map((row) => (
                      <tr key={row.key} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-3 font-medium text-slate-800">{row.label}</td>
                        <td className="px-5 py-3 tabular-nums text-slate-700">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-modern overflow-hidden border border-amber-100 bg-amber-50/20">
            <div className="border-b border-amber-100/80 bg-amber-50/60 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-900">¿Qué del Excel «Movimiento de Tutelas» cubre esta pantalla?</h2>
              <p className="mt-1 text-xs text-slate-600">
                Referencia al libro SIERJU (hoja de tutelas). No hay que implementarlo todo ahora: sirve para acordar qué datos
                ir guardando mientras consolidamos admisión y etapas siguientes.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-white/80">
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Bloque del formulario</th>
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">En esta app</th>
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 w-28">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {SIERJU_TUTELAS_COBERTURA.map((row) => (
                    <tr key={row.bloque} className="border-b border-slate-100/80 last:border-0 bg-white/40">
                      <td className="px-5 py-3 font-medium text-slate-800">{row.bloque}</td>
                      <td className="px-5 py-3 text-slate-600">{row.detalle}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            row.estado === 'si'
                              ? 'bg-emerald-100 text-emerald-900'
                              : row.estado === 'parcial'
                                ? 'bg-amber-100 text-amber-950'
                                : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {row.estado === 'si' ? 'Sí' : row.estado === 'parcial' ? 'Parcial' : 'No'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
