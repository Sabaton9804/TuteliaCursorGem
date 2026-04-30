import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { LayoutGrid, List, CalendarDays, ArrowDown, ArrowUp } from 'lucide-react';
import { formatRadicado } from '../../lib/formatters';
import {
  BOARD_STAGE_ORDER,
  type BoardStage,
  type ExpedienteViewRow,
  stageLabel,
  statusBadgeForStage,
} from '../../lib/expedientes-view-model';
import { startOfLocalDay } from '../../lib/business-days';
import clsx from 'clsx';

export type ExpedientesViewMode = 'kanban' | 'lista' | 'calendario';

function columnHeadClass(stage: BoardStage): string {
  switch (stage) {
    case 'radicado':
      return 'bg-slate-50 border-slate-200';
    case 'admitido':
      return 'bg-blue-50/80 border-blue-100';
    case 'esp_respuesta':
      return 'bg-emerald-50/80 border-emerald-100';
    case 'en_analisis':
      return 'bg-amber-50/80 border-amber-100';
    case 'fallo_redactado':
      return 'bg-violet-50/80 border-violet-100';
    case 'fallo_notificado':
      return 'bg-rose-50/80 border-rose-100';
    case 'archivado':
      return 'bg-slate-100 border-slate-200';
    default:
      return 'bg-slate-50 border-slate-200';
  }
}

function urgencyBorder(u: ExpedienteViewRow['urgency']): string {
  switch (u) {
    case 'urgent':
      return 'border-l-[3px] border-l-red-400';
    case 'warn':
      return 'border-l-[3px] border-l-amber-400';
    case 'ok':
      return 'border-l-[3px] border-l-emerald-400';
    default:
      return 'border-l-[3px] border-l-slate-200';
  }
}

/** Borde izquierdo más fino para fichas compactas del tablero. */
function kanbanUrgencyBorder(u: ExpedienteViewRow['urgency']): string {
  switch (u) {
    case 'urgent':
      return 'border-l-2 border-l-red-400';
    case 'warn':
      return 'border-l-2 border-l-amber-400';
    case 'ok':
      return 'border-l-2 border-l-emerald-400';
    default:
      return 'border-l-2 border-l-slate-200';
  }
}

function barFillClass(u: ExpedienteViewRow['urgency']): string {
  switch (u) {
    case 'urgent':
      return 'bg-red-400';
    case 'warn':
      return 'bg-amber-400';
    case 'ok':
      return 'bg-emerald-400';
    default:
      return 'bg-slate-400';
  }
}

function derechoPillClass(tag: string): string {
  if (tag === 'Sin indicar') return 'bg-slate-100 text-slate-500 border border-slate-200';
  return 'bg-slate-50 text-slate-700 border border-slate-200';
}

function derechoTooltip(r: ExpedienteViewRow): string | undefined {
  const t = r.case.legalDerechoTutelado?.replace(/\s+/g, ' ').trim();
  return t || undefined;
}

function daysLabel(r: ExpedienteViewRow): string {
  if (r.stage === 'archivado') return 'Cerrado';
  if (r.stage === 'fallo_redactado') return r.businessDaysRemaining <= 0 ? 'Firma (fuera término)' : 'Firma pend.';
  if (r.stage === 'fallo_notificado') return 'Imp: 3d háb. (demo)';
  if (r.businessDaysRemaining <= 0) return 'Vencido';
  return `${r.businessDaysRemaining}d háb.`;
}

function daysTextClass(r: ExpedienteViewRow): string {
  if (r.stage === 'archivado') return 'text-slate-400';
  if (r.urgency === 'urgent') return 'text-red-600';
  if (r.urgency === 'warn') return 'text-amber-700';
  if (r.urgency === 'ok') return 'text-emerald-700';
  return 'text-slate-500';
}

type ListaSortKey =
  | 'expediente'
  | 'estado'
  | 'derecho'
  | 'sustanciador'
  | 'termino'
  | 'radicacion'
  | 'dias_habiles';

type ListaSortDir = 'asc' | 'desc';

function stageOrderIndex(stage: BoardStage): number {
  const i = BOARD_STAGE_ORDER.indexOf(stage);
  return i < 0 ? 999 : i;
}

function compareListaRows(a: ExpedienteViewRow, b: ExpedienteViewRow, key: ListaSortKey, dir: ListaSortDir): number {
  const mul = dir === 'asc' ? 1 : -1;
  let cmp = 0;
  switch (key) {
    case 'expediente':
      cmp = a.case.radicado.localeCompare(b.case.radicado, 'es');
      if (cmp === 0) {
        cmp = `${a.case.claimant}\0${a.case.defendant || ''}`.localeCompare(
          `${b.case.claimant}\0${b.case.defendant || ''}`,
          'es',
          { sensitivity: 'base' }
        );
      }
      break;
    case 'estado':
      cmp = stageOrderIndex(a.stage) - stageOrderIndex(b.stage);
      break;
    case 'derecho':
      cmp = a.derechoTag.localeCompare(b.derechoTag, 'es', { sensitivity: 'base' });
      break;
    case 'sustanciador':
      cmp = a.assignee.name.localeCompare(b.assignee.name, 'es', { sensitivity: 'base' });
      break;
    case 'termino':
      cmp = a.termProgressPercent - b.termProgressPercent;
      if (cmp === 0) cmp = a.deadlineDate.getTime() - b.deadlineDate.getTime();
      break;
    case 'radicacion':
      cmp = a.filingDate.getTime() - b.filingDate.getTime();
      break;
    case 'dias_habiles':
      cmp = a.businessDaysRemaining - b.businessDaysRemaining;
      break;
    default:
      break;
  }
  if (cmp !== 0) return cmp * mul;
  return a.case.radicado.localeCompare(b.case.radicado, 'es');
}

const LISTA_GRID_COLS =
  'minmax(160px,1.1fr) 110px minmax(120px,1fr) 120px minmax(72px,0.7fr) 72px 52px' as const;

export interface ExpedientesViewsProps {
  rows: ExpedienteViewRow[];
  view: ExpedientesViewMode;
  onViewChange: (v: ExpedientesViewMode) => void;
  filterKind: 'all' | 'due' | 'mine';
  onFilterKind: (k: 'all' | 'due' | 'mine') => void;
  assigneeFilterId: string | 'all';
  onAssigneeFilterId: (id: string | 'all') => void;
  derechoFilter: string | 'all';
  onDerechoFilter: (tag: string | 'all') => void;
  assigneeOptions: { id: string; label: string }[];
  derechoOptions: string[];
  loading: boolean;
}

export default function ExpedientesViews({
  rows,
  view,
  onViewChange,
  filterKind,
  onFilterKind,
  assigneeFilterId,
  onAssigneeFilterId,
  derechoFilter,
  onDerechoFilter,
  assigneeOptions,
  derechoOptions,
  loading,
}: ExpedientesViewsProps) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => startOfLocalDay(new Date()));
  const [listaSortKey, setListaSortKey] = useState<ListaSortKey>('dias_habiles');
  const [listaSortDir, setListaSortDir] = useState<ListaSortDir>('asc');

  const byStage = useMemo(() => {
    const m = new Map<BoardStage, ExpedienteViewRow[]>();
    for (const s of BOARD_STAGE_ORDER) m.set(s, []);
    for (const r of rows) {
      const list = m.get(r.stage);
      if (list) list.push(r);
    }
    return m;
  }, [rows]);

  const sortedListRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareListaRows(a, b, listaSortKey, listaSortDir));
    return copy;
  }, [rows, listaSortKey, listaSortDir]);

  const onListaHeaderClick = (key: ListaSortKey) => {
    if (listaSortKey === key) {
      setListaSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setListaSortKey(key);
      setListaSortDir('asc');
    }
  };

  const calCells = useMemo(() => buildCalendarGrid(month), [month]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, ExpedienteViewRow[]>();
    for (const r of rows) {
      const k = format(startOfLocalDay(r.deadlineDate), 'yyyy-MM-dd');
      const arr = map.get(k) || [];
      arr.push(r);
      map.set(k, arr);
    }
    return map;
  }, [rows]);

  const openCase = (id: string) => navigate(`/case/${id}`);

  return (
    <div className="card-modern overflow-hidden flex flex-col min-h-[420px]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between px-4 py-3 border-b border-slate-100 bg-white">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50/80 p-0.5 shadow-sm">
          {(
            [
              { id: 'lista' as const, label: 'Lista', Icon: List },
              { id: 'kanban' as const, label: 'Tablero', Icon: LayoutGrid },
              { id: 'calendario' as const, label: 'Calendario', Icon: CalendarDays },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onViewChange(id)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
                view === id
                  ? 'bg-white text-accent shadow-sm border border-slate-200/80'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onFilterKind('all')}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
              filterKind === 'all'
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            )}
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => onFilterKind('due')}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
              filterKind === 'due'
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            )}
          >
            Próximas a vencer
          </button>
          <button
            type="button"
            onClick={() => onFilterKind('mine')}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
              filterKind === 'mine'
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            )}
          >
            Mis asignadas
          </button>

          <select
            className="input-modern py-1.5 text-[11px] min-w-[160px] bg-white"
            value={assigneeFilterId}
            onChange={(e) => onAssigneeFilterId((e.target.value as string | 'all') || 'all')}
            aria-label="Filtrar por sustanciador"
          >
            <option value="all">Sustanciador: todos</option>
            {assigneeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            className="input-modern py-1.5 text-[11px] min-w-[140px] bg-white"
            value={derechoFilter}
            onChange={(e) => onDerechoFilter((e.target.value as string | 'all') || 'all')}
            aria-label="Filtrar por derecho"
          >
            <option value="all">Derecho: todos</option>
            {derechoOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 bg-slate-50/50">
        {loading ? (
          <div className="py-20 text-center text-sm text-slate-400 animate-pulse">Cargando expedientes…</div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center text-sm text-slate-500">No hay expedientes con estos filtros.</div>
        ) : view === 'kanban' ? (
          <div className="flex gap-2 p-3 overflow-x-auto pb-4">
            {BOARD_STAGE_ORDER.map((stage) => {
              const list = byStage.get(stage) || [];
              return (
                <div key={stage} className="min-w-[128px] max-w-[152px] flex flex-col gap-1.5 shrink-0">
                  <div
                    className={clsx(
                      'rounded-md border px-1.5 py-1 mb-0.5',
                      columnHeadClass(stage)
                    )}
                  >
                    <div className="text-[10px] font-semibold text-slate-800 leading-tight">{stageLabel(stage)}</div>
                    <div className="text-[8px] text-slate-400 font-medium tabular-nums">{list.length}</div>
                  </div>
                  {list.map((r) => (
                    <button
                      key={r.case.id}
                      type="button"
                      onClick={() => openCase(r.case.id)}
                      title={`${r.case.claimant} vs ${r.case.defendant || '—'} — ${r.derechoTag}`}
                      className={clsx(
                        'text-left rounded-md border border-slate-200/90 bg-white px-2 py-1.5 shadow-sm hover:border-slate-300 hover:shadow-sm transition-all',
                        kanbanUrgencyBorder(r.urgency)
                      )}
                    >
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <div className="text-[8px] text-slate-400 font-mono truncate leading-tight min-w-0 flex-1">
                          {formatRadicado(r.case.radicado)}
                        </div>
                        <span
                          className={clsx(
                            'inline-flex w-5 h-5 shrink-0 items-center justify-center rounded-full text-[7px] font-bold ring-1',
                            r.assignee.bg,
                            r.assignee.text,
                            r.assignee.ring
                          )}
                          title={r.assignee.name}
                          aria-hidden
                        >
                          {r.assignee.initials}
                        </span>
                      </div>
                      <div className="text-[10px] font-semibold text-slate-800 leading-tight line-clamp-2 mb-0.5">
                        {r.case.claimant}
                        <span className="text-slate-400 font-normal"> vs </span>
                        {r.case.defendant || '—'}
                      </div>
                      <span
                        title={derechoTooltip(r)}
                        className={clsx(
                          'inline-block max-w-full text-[8px] px-1 py-px rounded font-medium leading-tight line-clamp-1 mb-1',
                          derechoPillClass(r.derechoTag)
                        )}
                      >
                        {r.derechoTag}
                      </span>
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-0.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={clsx('h-full rounded-full', barFillClass(r.urgency))}
                            style={{ width: `${r.termProgressPercent}%` }}
                          />
                        </div>
                        <span
                          className={clsx(
                            'text-[8px] font-semibold tabular-nums shrink-0 min-w-[2.5rem] text-right leading-none',
                            daysTextClass(r)
                          )}
                        >
                          {daysLabel(r)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : view === 'lista' ? (
          <div className="p-4 overflow-x-auto">
            <div
              className="grid gap-2 px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider min-w-[720px] items-center"
              style={{ gridTemplateColumns: LISTA_GRID_COLS }}
            >
              {(
                [
                  { key: 'expediente' as const, label: 'Expediente / partes' },
                  { key: 'estado' as const, label: 'Estado' },
                  { key: 'derecho' as const, label: 'Derecho tutelado' },
                  { key: 'sustanciador' as const, label: 'Sustanciador' },
                  { key: 'termino' as const, label: 'Término (10d háb.)' },
                  { key: 'radicacion' as const, label: 'Radicación' },
                  { key: 'dias_habiles' as const, label: 'Días háb.' },
                ] as const
              ).map(({ key, label }) => {
                const active = listaSortKey === key;
                const ariaSort = active ? (listaSortDir === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onListaHeaderClick(key)}
                    className={clsx(
                      'flex items-center gap-0.5 text-left min-w-0 rounded px-1 py-0.5 -mx-1 transition-colors',
                      'hover:text-slate-800 hover:bg-slate-100/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      active ? 'text-slate-800' : 'text-slate-400'
                    )}
                    aria-sort={ariaSort}
                  >
                    <span className="truncate">{label}</span>
                    {active ? (
                      listaSortDir === 'asc' ? (
                        <ArrowUp className="w-3 h-3 shrink-0 text-accent" aria-hidden />
                      ) : (
                        <ArrowDown className="w-3 h-3 shrink-0 text-accent" aria-hidden />
                      )
                    ) : null}
                  </button>
                );
              })}
            </div>
            {sortedListRows.map((r) => (
              <button
                key={r.case.id}
                type="button"
                onClick={() => openCase(r.case.id)}
                className={clsx(
                  'grid gap-2 px-2 py-2 rounded-lg border border-slate-200 bg-white text-left hover:border-slate-300 transition-colors min-w-[720px] w-full mb-1.5',
                  urgencyBorder(r.urgency)
                )}
                style={{ gridTemplateColumns: LISTA_GRID_COLS }}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800 truncate">
                    {r.case.claimant} vs {r.case.defendant || '—'}
                  </div>
                  <div className="text-[9px] text-slate-400 font-mono truncate mt-0.5">{r.case.radicado}</div>
                </div>
                <div className="flex items-center">
                  <span
                    className={clsx(
                      'inline-flex px-2 py-0.5 rounded text-[9px] font-semibold border',
                      statusBadgeForStage(r.stage)
                    )}
                  >
                    {stageLabel(r.stage)}
                  </span>
                </div>
                <div className="flex items-start min-w-0">
                  <span
                    title={derechoTooltip(r)}
                    className={clsx(
                      'text-[9px] px-1.5 py-0.5 rounded font-medium text-left line-clamp-3 min-w-0',
                      derechoPillClass(r.derechoTag)
                    )}
                  >
                    {r.derechoTag}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={clsx(
                      'inline-flex w-6 h-6 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ring-1',
                      r.assignee.bg,
                      r.assignee.text,
                      r.assignee.ring
                    )}
                  >
                    {r.assignee.initials}
                  </span>
                  <span className="text-[11px] text-slate-500 truncate">{r.assignee.name}</span>
                </div>
                <div className="flex items-center pr-1">
                  <div className="w-full h-1 bg-slate-100 rounded overflow-hidden">
                    <div
                      className={clsx('h-full rounded', barFillClass(r.urgency))}
                      style={{ width: `${r.termProgressPercent}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center text-[10px] text-slate-500 whitespace-nowrap">
                  {format(r.filingDate, 'd MMM yyyy', { locale: es })}
                </div>
                <div className={clsx('flex items-center text-xs font-semibold tabular-nums', daysTextClass(r))}>
                  {r.businessDaysRemaining <= 0 && r.stage !== 'archivado' ? '0' : r.stage === 'archivado' ? '—' : String(r.businessDaysRemaining)}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-800">
                {format(month, 'MMMM yyyy', { locale: es })} — Vencimiento término (10 días hábiles)
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] text-slate-600 hover:bg-slate-50"
                  onClick={() => setMonth((d) => addMonthsSafe(d, -1))}
                >
                  ← Anterior
                </button>
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] text-slate-600 hover:bg-slate-50"
                  onClick={() => setMonth((d) => addMonthsSafe(d, 1))}
                >
                  Siguiente →
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                <div key={d} className="text-center text-[9px] font-bold text-slate-400 uppercase py-1">
                  {d}
                </div>
              ))}
              {calCells.map((cell, idx) => {
                if (cell === null) {
                  return <div key={`e-${idx}`} className="min-h-[76px] rounded-lg bg-transparent" />;
                }
                const { date, inMonth } = cell;
                const k = format(startOfLocalDay(date), 'yyyy-MM-dd');
                const evs = eventsByDay.get(k) || [];
                const today = isSameDay(startOfLocalDay(date), startOfLocalDay(new Date()));
                return (
                  <div
                    key={k}
                    className={clsx(
                      'min-h-[76px] rounded-lg border p-1.5 flex flex-col gap-0.5',
                      !inMonth && 'opacity-40',
                      today ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'
                    )}
                  >
                    <div
                      className={clsx(
                        'text-[10px] font-medium tabular-nums',
                        today ? 'text-blue-700' : 'text-slate-500'
                      )}
                    >
                      {format(date, 'd')}
                    </div>
                    {evs.slice(0, 3).map((r) => (
                      <button
                        key={r.case.id}
                        type="button"
                        onClick={() => openCase(r.case.id)}
                        className={clsx(
                          'text-left text-[9px] px-1 py-0.5 rounded truncate w-full',
                          eventTone(r)
                        )}
                        title={`${r.case.claimant} — ${stageLabel(r.stage)}`}
                      >
                        {shortParty(r.case.claimant)} · {r.businessDaysRemaining <= 0 ? 'vence' : `${r.businessDaysRemaining}d`}
                      </button>
                    ))}
                    {evs.length > 3 && (
                      <span className="text-[8px] text-slate-400">+{evs.length - 3}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-slate-100 bg-white text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-0.5 rounded bg-red-400" />
          Urgente (≤2d háb.)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-0.5 rounded bg-amber-400" />
          Atención (3–4d háb.)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-0.5 rounded bg-emerald-400" />
          Normal (5–10d háb.)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-0.5 rounded bg-slate-400" />
          Cerrado / notificado
        </span>
        <span className="ml-auto text-slate-400">
          Término: 10 días hábiles desde radicación (Colombia: festivos, Semana Santa, 17 dic., vacancia judicial).
        </span>
      </div>
    </div>
  );
}

function shortParty(name: string): string {
  const w = name.trim().split(/\s+/)[0] || name;
  return w.length > 14 ? `${w.slice(0, 12)}…` : w;
}

function eventTone(r: ExpedienteViewRow): string {
  if (r.urgency === 'urgent') return 'bg-rose-100 text-rose-800';
  if (r.urgency === 'warn') return 'bg-amber-100 text-amber-900';
  if (r.urgency === 'ok') return 'bg-emerald-100 text-emerald-900';
  return 'bg-slate-100 text-slate-600';
}

function addMonthsSafe(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return startOfMonth(x);
}

type CalCell = { date: Date; inMonth: boolean } | null;

function buildCalendarGrid(monthAnchor: Date): CalCell[] {
  const sm = startOfMonth(monthAnchor);
  const em = endOfMonth(monthAnchor);
  const cells: CalCell[] = [];
  for (let i = 0; i < mondayIndex(sm); i += 1) cells.push(null);

  const cur = new Date(sm);
  while (cur <= em) {
    cells.push({ date: new Date(cur), inMonth: true });
    cur.setDate(cur.getDate() + 1);
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    if (last && 'date' in last) {
      const nd = new Date(last.date);
      nd.setDate(nd.getDate() + 1);
      cells.push({ date: nd, inMonth: false });
    } else {
      cells.push(null);
    }
  }

  return cells;
}

/** Desplazamiento del primer día del mes para grid Lun–Dom (0 = lunes). */
function mondayIndex(d: Date): number {
  const day = d.getDay();
  return (day + 6) % 7;
}
