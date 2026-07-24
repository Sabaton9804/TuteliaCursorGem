import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Clock,
  Info,
  LayoutDashboard,
  Loader2,
  PieChart,
  Table2,
} from 'lucide-react';
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
import { DECISION_TYPES, DECISION_TYPE_LABELS } from '../lib/sierju-case-codes';
import { SIERJU_TUTELAS_COBERTURA, type TutelaStatsScope } from '../lib/sierju-tutela-informe';
import {
  buildTutelaStatsDashboard,
  type StatsTimeGranularity,
} from '../lib/tutela-stats-dashboard';
import { StatsBarChart } from '../components/estadisticas/StatsBarChart';
import { StatsTimeSeriesChart } from '../components/estadisticas/StatsTimeSeriesChart';
import { StatsSegmentBar } from '../components/estadisticas/StatsSegmentBar';
import { useSessionCourt } from '../contexts/SessionCourtContext';

type PeriodPreset = 'week' | 'month' | 'quarter' | 'year' | 'last30' | 'custom';
type StatsTab = 'resumen' | 'movimiento' | 'tiempos' | 'sierju';

function rangeForPreset(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
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

const CASE_STATS_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'status',
  'operational_status',
  'deadline_at',
  'derecho_tutelado_code',
  'decision_type',
  'decision_at',
  'legal_derecho_tutelado',
  'radicado',
  'court_id',
  'case_type',
  'sierju_process_class_id',
  'sierju_metadata',
].join(',');

const TABS: { id: StatsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'movimiento', label: 'Movimiento', icon: BarChart3 },
  { id: 'tiempos', label: 'Tiempos y plazos', icon: Clock },
  { id: 'sierju', label: 'SIERJU oficial', icon: Table2 },
];

function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  accent?: string;
}) {
  return (
    <div className="card-modern border border-slate-100 p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export default function Estadisticas() {
  const { courtId } = useSessionCourt();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>('quarter');
  const [scope, setScope] = useState<TutelaStatsScope>('primera');
  const [tab, setTab] = useState<StatsTab>('resumen');
  const [granularity, setGranularity] = useState<StatsTimeGranularity>('month');
  const [customFrom, setCustomFrom] = useState(() => format(startOfQuarter(new Date()), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(() => format(endOfQuarter(new Date()), 'yyyy-MM-dd'));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('cases')
      .select(CASE_STATS_COLUMNS)
      .eq('court_id', courtId);
    if (fetchError) {
      setError(fetchError.message);
      setCases([]);
      setLoading(false);
      return;
    }
    setCases((data || []).map((r) => rowToCase(r as unknown as Record<string, unknown>)));
    setLoading(false);
  }, [courtId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { from, to } = useMemo(
    () => rangeForPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const dash = useMemo(
    () => buildTutelaStatsDashboard(cases, from, to, scope, granularity),
    [cases, from, to, scope, granularity],
  );

  const { informe } = dash;
  const periodoLabel = `${format(from, 'd MMM yyyy', { locale: es })} — ${format(to, 'd MMM yyyy', { locale: es })}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <PieChart className="h-4 w-4 text-accent" aria-hidden />
            Centro de estadísticas · Tutelas
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Panel analítico</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Gráficos, plazos y borrador SIERJU. Datos internos del despacho; el formulario oficial CSJ sigue
            requiriendo inventarios y export trimestral.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Actualizar
        </button>
      </header>

      <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm text-blue-950">
        <div className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
          <p className="text-xs leading-relaxed">
            <strong className="font-semibold">Borrador Jurion</strong> — ingresos por radicación, salidas por{' '}
            <code className="rounded bg-white/80 px-1">decision_at</code>, plazos con días hábiles del término
            global (10 días tutela 1ª). <strong className="font-semibold">Oficial CSJ</strong>: inventarios y
            columnas de entrada detalladas (Fase S3).
          </p>
        </div>
      </div>

      <div className="card-modern space-y-4 border border-slate-100 p-5 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Alcance</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ['primera', 'Tutela 1ª instancia'],
                  ['todas_tutelas', 'Todas las tutelas'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScope(key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    scope === key
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Periodo</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ['week', 'Semana'],
                  ['month', 'Mes'],
                  ['quarter', 'Trimestre'],
                  ['year', 'Año'],
                  ['last30', '30 días'],
                  ['custom', 'Custom'],
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
          </div>
        </div>
        {preset === 'custom' ? (
          <div className="flex flex-wrap items-center gap-3">
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
        <p className="text-sm font-medium text-slate-600">{periodoLabel}</p>

        <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-4">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
                tab === id
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      ) : null}

      {loading && cases.length === 0 ? (
        <div className="card-modern flex items-center justify-center gap-2 p-12 text-sm font-medium text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando…
        </div>
      ) : (
        <>
          {tab === 'resumen' ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Ingresos" value={informe.ingresosCount} hint="Radicadas en el periodo" />
                <KpiCard label="Salidas" value={informe.salidasCount} hint="Decisiones en el periodo" accent="text-violet-700" />
                <KpiCard
                  label="Activas"
                  value={informe.activos}
                  hint={`${informe.totalExpedientes} totales en alcance`}
                />
                <KpiCard
                  label="Tasa concesión"
                  value={dash.tasaConcesion != null ? `${dash.tasaConcesion}%` : '—'}
                  hint="Concede / (Concede + Niega) en el periodo"
                  accent="text-emerald-700"
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card-modern border border-slate-100 p-5">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-slate-800">Evolución ingresos vs salidas</h2>
                    <div className="flex gap-1">
                      {(['week', 'month'] as const).map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGranularity(g)}
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            granularity === g ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {g === 'week' ? 'Sem' : 'Mes'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <StatsTimeSeriesChart points={dash.timeSeries} />
                </div>

                <div className="card-modern border border-slate-100 p-5">
                  <h2 className="mb-4 text-sm font-bold text-slate-800">Top derechos tutelados (ingresos)</h2>
                  <StatsBarChart rows={dash.topDerechosIngreso} />
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card-modern border border-slate-100 p-5">
                  <h2 className="mb-4 text-sm font-bold text-slate-800">Estado judicial (activas)</h2>
                  <StatsSegmentBar rows={dash.statusCounts} emptyLabel="No hay tutelas activas." />
                </div>
                <div className="card-modern border border-slate-100 p-5">
                  <h2 className="mb-4 text-sm font-bold text-slate-800">Etapa operativa (tablero)</h2>
                  <StatsSegmentBar rows={dash.stageCounts} />
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'movimiento' ? (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card-modern border border-slate-100 p-5">
                  <h2 className="mb-1 text-sm font-bold text-slate-800">Ingresos por derecho</h2>
                  <p className="mb-4 text-xs text-slate-500">Proxy SIERJU: tutela_entrada_reparto</p>
                  <StatsBarChart rows={informe.porDerechoIngreso.filter((r) => r.count > 0).map((r) => ({
                    key: r.key,
                    label: r.label,
                    value: r.count,
                    color: r.key === '__SIN_CLASIFICAR__' ? '#f59e0b' : '#0d9488',
                  }))} />
                </div>
                <div className="card-modern border border-slate-100 p-5">
                  <h2 className="mb-1 text-sm font-bold text-slate-800">Salidas por decisión</h2>
                  <p className="mb-4 text-xs text-slate-500">Mapeo a tutela_salida_* del catálogo</p>
                  <StatsBarChart rows={dash.topDecisiones} horizontal={false} />
                </div>
              </div>

              {informe.matrizSalida.length > 0 ? (
                <div className="card-modern overflow-hidden border border-slate-100">
                  <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-3">
                    <h2 className="text-sm font-bold text-slate-800">Mapa de calor — derecho × decisión</h2>
                    <p className="text-xs text-slate-500">Intensidad = cantidad en el periodo</p>
                  </div>
                  <div className="overflow-x-auto p-4">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr>
                          <th className="pb-2 text-[10px] font-bold uppercase text-slate-400">Derecho</th>
                          {DECISION_TYPES.map((dt) => (
                            <th key={dt} className="px-1 pb-2 text-center text-[9px] font-bold uppercase text-slate-400">
                              {dt.slice(0, 4)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {informe.matrizSalida.map((row) => {
                          const cellMap = new Map(row.cells.map((c) => [c.decision, c.count]));
                          const rowMax = Math.max(1, ...row.cells.map((c) => c.count));
                          return (
                            <tr key={row.rowKey}>
                              <td className="py-1.5 pr-2 font-medium text-slate-800">{row.rowLabel}</td>
                              {DECISION_TYPES.map((dt) => {
                                const n = cellMap.get(dt) ?? 0;
                                const alpha = n > 0 ? 0.15 + (n / rowMax) * 0.75 : 0;
                                return (
                                  <td key={dt} className="p-0.5">
                                    <div
                                      className="flex h-9 min-w-[2rem] items-center justify-center rounded-md text-xs font-bold tabular-nums"
                                      style={{
                                        backgroundColor: n > 0 ? `rgba(13, 148, 136, ${alpha})` : '#f8fafc',
                                        color: n > 0 ? '#0f766e' : '#cbd5e1',
                                      }}
                                      title={n > 0 ? `${DECISION_TYPE_LABELS[dt]}: ${n}` : undefined}
                                    >
                                      {n || '·'}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'tiempos' ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <KpiCard
                  label="Vencidas"
                  value={dash.termBuckets.vencidos}
                  hint="Término global agotado"
                  accent="text-red-600"
                />
                <KpiCard
                  label="Urgentes"
                  hint="≤ 2 días hábiles"
                  value={dash.termBuckets.urgentes}
                  accent="text-orange-600"
                />
                <KpiCard label="Alerta" value={dash.termBuckets.alerta} hint="3–4 días hábiles" accent="text-amber-600" />
                <KpiCard label="En término" value={dash.termBuckets.enTermino} hint="5+ días hábiles" accent="text-emerald-700" />
                <KpiCard label="Cerradas" value={dash.termBuckets.cerrados} hint="Archivadas o fallo notificado" />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card-modern border border-slate-100 p-5">
                  <h2 className="mb-4 text-sm font-bold text-slate-800">Semáforo de plazos (cartera actual)</h2>
                  <StatsBarChart
                    rows={[
                      { key: 'v', label: 'Vencidas', value: dash.termBuckets.vencidos, color: '#dc2626' },
                      { key: 'u', label: 'Urgentes', value: dash.termBuckets.urgentes, color: '#ea580c' },
                      { key: 'a', label: 'Alerta', value: dash.termBuckets.alerta, color: '#d97706' },
                      { key: 'ok', label: 'En término', value: dash.termBuckets.enTermino, color: '#059669' },
                    ].filter((r) => r.value > 0)}
                  />
                </div>
                <div className="card-modern border border-slate-100 p-5">
                  <h2 className="mb-4 text-sm font-bold text-slate-800">Tiempo hasta decisión</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl bg-slate-50 p-4 text-center">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Promedio</p>
                      <p className="mt-1 text-3xl font-bold text-slate-900">
                        {dash.tiemposFallo.promedioDias ?? '—'}
                        {dash.tiemposFallo.promedioDias != null ? (
                          <span className="text-base font-semibold text-slate-400"> d</span>
                        ) : null}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4 text-center">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Mediana</p>
                      <p className="mt-1 text-3xl font-bold text-slate-900">
                        {dash.tiemposFallo.medianaDias ?? '—'}
                        {dash.tiemposFallo.medianaDias != null ? (
                          <span className="text-base font-semibold text-slate-400"> d</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-xs text-slate-500">
                    Días calendario desde radicación hasta decisión registrada. Muestra:{' '}
                    {dash.tiemposFallo.muestra} expedientes (histórico en alcance, no solo periodo).
                  </p>
                </div>
              </div>

              <div className="card-modern border border-slate-100 p-5">
                <h2 className="mb-4 text-sm font-bold text-slate-800">Radicaciones en el tiempo</h2>
                <StatsTimeSeriesChart points={dash.timeSeries} showSalidas={false} />
              </div>
            </div>
          ) : null}

          {tab === 'sierju' ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <KpiCard
                  label="Clasificación SIERJU"
                  value={`${informe.conClaseSierju}/${informe.totalExpedientes}`}
                  hint="Con sierju_process_class_id"
                />
                <KpiCard
                  label="Código explícito"
                  value={informe.conCodigoExplicito}
                  hint="derecho_tutelado_code en BD"
                />
                <KpiCard
                  label="Sin clasificar"
                  value={dash.sinClasificar}
                  hint="Ingresos del periodo sin fila SIERJU"
                  accent={dash.sinClasificar > 0 ? 'text-amber-700' : undefined}
                />
              </div>

              <details className="card-modern group border border-amber-100 bg-amber-50/20">
                <summary className="cursor-pointer list-none px-5 py-4 font-bold text-slate-900 marker:content-none">
                  <span className="flex items-center justify-between gap-2">
                    Cobertura vs formulario CSJ «Movimiento de Tutelas»
                    <span className="text-xs font-normal text-slate-500 group-open:hidden">Ver detalle</span>
                  </span>
                </summary>
                <div className="overflow-x-auto border-t border-amber-100/80">
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {SIERJU_TUTELAS_COBERTURA.map((row) => (
                        <tr key={row.bloque} className="border-b border-amber-100/60 last:border-0">
                          <td className="px-5 py-3 font-medium text-slate-800">{row.bloque}</td>
                          <td className="px-5 py-3 text-slate-600">{row.detalle}</td>
                          <td className="w-28 px-5 py-3">
                            <span
                              className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
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
              </details>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
