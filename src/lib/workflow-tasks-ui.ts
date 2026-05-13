import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Gavel,
  Mail,
  Scale,
  Send,
  Wrench,
  ClipboardList,
  Shield,
  Link2,
} from 'lucide-react';
import { differenceInCalendarDays, endOfDay, isValid, parseISO, startOfDay } from 'date-fns';

export type WorkflowTaskStatus = 'pending' | 'completed' | 'escalated' | 'archived';

export type WorkflowTaskType =
  | 'draft_auto'
  | 'review_judge'
  | 'generate_notifs'
  | 'draft_fallo'
  | 'review_corrections'
  | 'custom'
  | 'informe_ingreso'
  | 'notificacion_accionado'
  | 'remision_corte'
  | 'consulta_desacato';

export const WORKFLOW_TASK_TYPE_LABEL: Record<WorkflowTaskType, string> = {
  draft_auto: 'Borrador automático',
  review_judge: 'Revisión juez',
  generate_notifs: 'Generar notificaciones',
  draft_fallo: 'Borrador de fallo',
  review_corrections: 'Correcciones',
  custom: 'Trámite / etapa',
  informe_ingreso: 'Informe de ingreso',
  notificacion_accionado: 'Notificación accionado',
  remision_corte: 'Remisión a Corte',
  consulta_desacato: 'Consulta de desacato',
};

export const WORKFLOW_TASK_TYPE_ICON: Record<WorkflowTaskType, LucideIcon> = {
  draft_auto: FileText,
  review_judge: Gavel,
  generate_notifs: Mail,
  draft_fallo: Scale,
  review_corrections: ClipboardList,
  custom: Wrench,
  informe_ingreso: FileText,
  notificacion_accionado: Send,
  remision_corte: Link2,
  consulta_desacato: Shield,
};

export type WorkflowPriority = 'low' | 'medium' | 'high' | 'urgent';

export function priorityLabelEs(p: WorkflowPriority): string {
  switch (p) {
    case 'urgent':
      return 'Urgente';
    case 'high':
      return 'Alta';
    case 'medium':
      return 'Media';
    case 'low':
      return 'Baja';
    default:
      return p;
  }
}

/** Clases Tailwind para chip de prioridad. */
export function priorityChipClass(p: WorkflowPriority): string {
  switch (p) {
    case 'urgent':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'high':
      return 'bg-orange-100 text-orange-900 border-orange-200';
    case 'medium':
      return 'bg-blue-100 text-blue-900 border-blue-200';
    case 'low':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

/** Semáforo plazo: rojo vencida, naranja hoy o mañana, verde resto; null = sin fecha. */
export function deadlineTrafficLight(deadlineIso: string | null | undefined): {
  label: string;
  dotClass: string;
  textClass: string;
} {
  if (!deadlineIso?.trim()) {
    return { label: 'Sin fecha límite', dotClass: 'bg-slate-300', textClass: 'text-slate-500' };
  }
  const d = parseISO(deadlineIso);
  if (!isValid(d)) {
    return { label: 'Fecha inválida', dotClass: 'bg-slate-300', textClass: 'text-slate-500' };
  }
  const now = new Date();
  const endTomorrow = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (d.getTime() < now.getTime()) {
    return { label: 'Vencida', dotClass: 'bg-red-500', textClass: 'text-red-700 font-bold' };
  }
  const days = differenceInCalendarDays(startOfDay(d), startOfDay(now));
  if (days <= 1) {
    return { label: 'Vence hoy o mañana', dotClass: 'bg-orange-500', textClass: 'text-orange-800 font-semibold' };
  }
  return { label: 'A tiempo', dotClass: 'bg-emerald-500', textClass: 'text-emerald-800' };
}

/** ISO: tareas pending con deadline anterior a (ahora - 24h) pasan a escalated. */
export function overdueThresholdIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}
