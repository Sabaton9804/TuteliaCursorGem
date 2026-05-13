import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  ListTodo,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ensureSupabaseSessionForWrites } from '../lib/supabase-write-auth';
import { formatRadicado } from '../lib/formatters';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import { escalateStaleWorkflowTasks } from '../lib/workflow-task-escalation';
import {
  WORKFLOW_TASK_TYPE_ICON,
  WORKFLOW_TASK_TYPE_LABEL,
  deadlineTrafficLight,
  priorityChipClass,
  priorityLabelEs,
  type WorkflowPriority,
  type WorkflowTaskStatus,
  type WorkflowTaskType,
} from '../lib/workflow-tasks-ui';

type TaskTab = 'pendientes' | 'en_curso' | 'completadas';

type WorkflowTaskRow = {
  id: string;
  case_id: string;
  radicado: string | null;
  title: string;
  description: string | null;
  status: WorkflowTaskStatus;
  priority: WorkflowPriority;
  task_type: WorkflowTaskType;
  deadline: string | null;
  completed_at: string | null;
  created_at: string;
};

const TASK_TYPES: WorkflowTaskType[] = [
  'draft_auto',
  'review_judge',
  'generate_notifs',
  'draft_fallo',
  'review_corrections',
  'custom',
  'informe_ingreso',
  'notificacion_accionado',
  'remision_corte',
  'consulta_desacato',
];

const PRIORITIES: WorkflowPriority[] = ['urgent', 'high', 'medium', 'low'];

function parseTaskType(raw: unknown): WorkflowTaskType {
  if (typeof raw === 'string' && (TASK_TYPES as readonly string[]).includes(raw)) {
    return raw as WorkflowTaskType;
  }
  return 'custom';
}

function parsePriority(raw: unknown): WorkflowPriority {
  if (typeof raw === 'string' && (PRIORITIES as readonly string[]).includes(raw)) {
    return raw as WorkflowPriority;
  }
  return 'medium';
}

function parseStatus(raw: unknown): WorkflowTaskStatus {
  if (raw === 'pending' || raw === 'completed' || raw === 'escalated' || raw === 'archived') {
    return raw;
  }
  return 'pending';
}

function radicadoFromRow(row: Record<string, unknown>): string {
  const top = row.radicado;
  if (typeof top === 'string' && top.trim()) return top.trim();
  const cases = row.cases as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  if (cases && !Array.isArray(cases) && typeof cases === 'object') {
    const cr = (cases as Record<string, unknown>).radicado;
    if (typeof cr === 'string' && cr.trim()) return cr.trim();
  }
  if (Array.isArray(cases) && cases[0] && typeof cases[0] === 'object') {
    const cr = (cases[0] as Record<string, unknown>).radicado;
    if (typeof cr === 'string' && cr.trim()) return cr.trim();
  }
  return '';
}

function rowToTask(row: Record<string, unknown>): WorkflowTaskRow {
  return {
    id: String(row.id),
    case_id: String(row.case_id ?? ''),
    radicado: radicadoFromRow(row) || null,
    title: String(row.title ?? 'Sin título'),
    description: row.description ? String(row.description) : null,
    status: parseStatus(row.status),
    priority: parsePriority(row.priority),
    task_type: parseTaskType(row.task_type),
    deadline: typeof row.deadline === 'string' ? row.deadline : row.deadline ? String(row.deadline) : null,
    completed_at:
      typeof row.completed_at === 'string' ? row.completed_at : row.completed_at ? String(row.completed_at) : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : String(row.created_at ?? ''),
  };
}

function formatDeadlineDisplay(iso: string | null): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  return format(d, "d MMM yyyy HH:mm", { locale: es });
}

export default function Tasks() {
  const navigate = useNavigate();
  const { courtId, profile } = useSessionCourt();
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WorkflowTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TaskTab>('pendientes');
  const [filterType, setFilterType] = useState<WorkflowTaskType | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<WorkflowPriority | 'all'>('all');
  const [completingId, setCompletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setUserId(data.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadTasks = useCallback(async () => {
    if (!userId || !courtId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await escalateStaleWorkflowTasks(supabase, { assigneeId: userId, courtId });
      const { data, error: qErr } = await supabase
        .from('workflow_tasks')
        .select('id, case_id, radicado, title, description, status, priority, task_type, deadline, completed_at, created_at, cases(radicado)')
        .eq('assignee_id', userId)
        .eq('court_id', courtId)
        .in('status', ['pending', 'escalated', 'completed'])
        .order('created_at', { ascending: false });
      if (qErr) throw qErr;
      setTasks((data ?? []).map((r) => rowToTask(r as Record<string, unknown>)));
    } catch (e: unknown) {
      console.error('workflow_tasks:', e);
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las tareas.');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [userId, courtId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`workflow-tasks-inbox-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workflow_tasks', filter: `assignee_id=eq.${userId}` },
        () => void loadTasks(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [userId, loadTasks]);

  useEffect(() => {
    if (!userId || !courtId) return;
    const t = window.setInterval(() => {
      void (async () => {
        const n = await escalateStaleWorkflowTasks(supabase, { assigneeId: userId, courtId });
        if (n > 0) void loadTasks();
      })();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [userId, courtId, loadTasks]);

  useEffect(() => {
    const onFocus = () => void loadTasks();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadTasks]);

  const filteredByFilters = useMemo(() => {
    return tasks.filter((t) => {
      if (filterType !== 'all' && t.task_type !== filterType) return false;
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
      return true;
    });
  }, [tasks, filterType, filterPriority]);

  const pendientes = useMemo(
    () => filteredByFilters.filter((t) => t.status === 'pending'),
    [filteredByFilters],
  );
  const enCurso = useMemo(
    () => filteredByFilters.filter((t) => t.status === 'escalated'),
    [filteredByFilters],
  );
  const completadas = useMemo(
    () => filteredByFilters.filter((t) => t.status === 'completed'),
    [filteredByFilters],
  );

  const openCount = useMemo(() => tasks.filter((t) => t.status === 'pending' || t.status === 'escalated').length, [tasks]);

  const listForTab = tab === 'pendientes' ? pendientes : tab === 'en_curso' ? enCurso : completadas;

  const markComplete = async (taskId: string) => {
    if (!userId) return;
    setCompletingId(taskId);
    setError(null);
    try {
      await ensureSupabaseSessionForWrites();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from('workflow_tasks')
        .update({ status: 'completed', completed_at: now, updated_at: now })
        .eq('id', taskId)
        .eq('assignee_id', userId);
      if (upErr) throw upErr;
      await loadTasks();
      setTab('completadas');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la tarea.');
    } finally {
      setCompletingId(null);
    }
  };

  const displayName = (profile?.name || 'Funcionario').trim();

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-accent/10 p-3 text-accent">
              <ListTodo className="h-7 w-7" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Centro de trabajo</h1>
              <p className="text-sm font-medium text-slate-500 mt-1">
                Bandeja de <span className="text-slate-800 font-semibold">{displayName}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-center sm:text-right">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pendientes + en curso</p>
          <p className="text-3xl font-black tabular-nums text-accent">{openCount}</p>
        </div>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="filter-task-type">
            Tipo de tarea
          </label>
          <select
            id="filter-task-type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as WorkflowTaskType | 'all')}
            className="input-modern min-h-[44px] text-xs font-semibold min-w-[200px]"
          >
            <option value="all">Todos los tipos</option>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {WORKFLOW_TASK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="filter-priority">
            Prioridad
          </label>
          <select
            id="filter-priority"
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as WorkflowPriority | 'all')}
            className="input-modern min-h-[44px] text-xs font-semibold min-w-[160px]"
          >
            <option value="all">Todas las prioridades</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabelEs(p)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1">
        {(
          [
            { id: 'pendientes' as const, label: 'Pendientes', count: pendientes.length },
            { id: 'en_curso' as const, label: 'En curso', count: enCurso.length },
            { id: 'completadas' as const, label: 'Completadas', count: completadas.length },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-3 py-2.5 text-center text-xs font-black uppercase tracking-widest transition-colors ${
              tab === t.id ? 'bg-white text-accent shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-80">({t.count})</span>
          </button>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 -mt-4">
        <span className="font-semibold text-slate-600">En curso</span> agrupa tareas marcadas como escaladas (vencidas más de 24 h sin completar).
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-500 font-medium">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          Cargando tareas…
        </div>
      ) : !userId ? (
        <p className="text-center text-sm text-slate-500 py-16">Inicie sesión para ver su bandeja.</p>
      ) : listForTab.length === 0 ? (
        <p className="text-center text-sm text-slate-500 py-16 border border-dashed border-slate-200 rounded-2xl bg-slate-50/80">
          No hay tareas en esta bandeja con los filtros actuales.
        </p>
      ) : (
        <ul className="space-y-4">
          {listForTab.map((task) => {
            const TypeIcon = WORKFLOW_TASK_TYPE_ICON[task.task_type] ?? WORKFLOW_TASK_TYPE_ICON.custom;
            const dl = deadlineTrafficLight(task.deadline);
            const rad = task.radicado?.trim() || '—';
            const showEscalada = task.status === 'escalated';
            return (
              <li
                key={task.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-start gap-2">
                    {showEscalada ? (
                      <span className="rounded-md bg-red-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">
                        Escalada
                      </span>
                    ) : null}
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${priorityChipClass(task.priority)}`}
                    >
                      {priorityLabelEs(task.priority)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      <TypeIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                      {WORKFLOW_TASK_TYPE_LABEL[task.task_type]}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-slate-900 leading-snug">{task.title}</h2>
                  {task.description ? (
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{task.description}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        Expediente
                      </span>
                      {task.case_id ? (
                        <Link
                          to={`/case/${task.case_id}`}
                          className="font-mono font-bold text-accent hover:underline"
                        >
                          {rad !== '—' ? formatRadicado(rad) : 'Ver expediente'}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        Responsable
                      </span>
                      <span className="font-semibold text-slate-800">{displayName}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        Plazo
                      </span>
                      <span className={`inline-flex items-center gap-1.5 font-medium ${dl.textClass}`}>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${dl.dotClass}`} aria-hidden />
                        {formatDeadlineDisplay(task.deadline)}
                        <span className="text-slate-400 font-normal">· {dl.label}</span>
                      </span>
                    </div>
                    {task.status === 'completed' && task.completed_at ? (
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                          Completada
                        </span>
                        <span className="font-medium text-emerald-800">{formatDeadlineDisplay(task.completed_at)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0 lg:w-48">
                  {task.status !== 'completed' ? (
                    <button
                      type="button"
                      disabled={completingId === task.id}
                      onClick={() => void markComplete(task.id)}
                      className="btn-primary flex items-center justify-center gap-2 py-2.5 text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                    >
                      {completingId === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Marcar completada
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => navigate(`/case/${task.case_id}`)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Ver expediente
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
