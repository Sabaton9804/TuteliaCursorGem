import React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Shield } from 'lucide-react';
import type { CaseAuditLogEntry } from '../../types';
import { humanizeCaseAuditEntry } from '../../lib/audit-log-humanize';

export type CaseHistorialPanelProps = {
  auditLog: CaseAuditLogEntry[];
  auditFetchErr: string | null;
  auditActorNames: Record<string, string>;
};

/** Pestaña «Historial»: actividad / auditoría del expediente. */
export function CaseHistorialPanel({ auditLog, auditFetchErr, auditActorNames }: CaseHistorialPanelProps) {
  return (
    <div className="card-modern flex w-full min-w-0 flex-col p-6 scroll-mt-24 sm:p-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          <Shield className="h-4 w-4 text-slate-500" aria-hidden />
          Actividad en el expediente
        </h3>
        <p className="max-w-xl text-[11px] leading-snug text-slate-600">
          Resumen en lenguaje claro de cada cambio guardado (documentos, datos del expediente, actuaciones, revisiones
          Word, notificaciones). El detalle crudo de base de datos sigue disponible desplegando «Datos técnicos». No
          reemplaza actuaciones judiciales registradas en autos.
        </p>
      </div>
      {auditFetchErr ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{auditFetchErr}</p>
      ) : null}
      {!auditFetchErr && auditLog.length === 0 ? (
        <p className="text-sm text-slate-500">
          Aún no hay actividad registrada para este expediente. Cuando exista la tabla de auditoría en Supabase, cada
          cambio aparecerá aquí automáticamente.
        </p>
      ) : null}
      <div className="scrollbar-thin mt-4 max-h-[min(72vh,720px)] space-y-3 overflow-y-auto pr-1">
        {auditLog.map((entry) => {
          const actorLabel =
            (entry.actorUserId && auditActorNames[entry.actorUserId]) ||
            (entry.actorUserId ? `Usuario ${entry.actorUserId.slice(0, 8)}…` : 'Usuario del sistema');
          const human = humanizeCaseAuditEntry(entry);
          const atLabel =
            entry.occurredAt && !Number.isNaN(Date.parse(entry.occurredAt))
              ? format(new Date(entry.occurredAt), 'dd MMM yyyy · HH:mm', { locale: es })
              : '';
          const initial = (actorLabel.replace(/^Usuario\s+/i, '').trim().charAt(0) || '?').toUpperCase();
          const ring =
            human.kind === 'add'
              ? 'border-emerald-200 bg-emerald-50/80'
              : human.kind === 'remove'
                ? 'border-rose-200 bg-rose-50/80'
                : human.kind === 'edit'
                  ? 'border-sky-200 bg-sky-50/80'
                  : 'border-slate-200 bg-slate-50/80';
          return (
            <details
              key={entry.id}
              className={`group rounded-xl border ${ring} px-3 py-3 sm:px-4 open:bg-white`}
            >
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div className="flex gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white bg-white text-sm font-bold text-slate-600 shadow-sm"
                    aria-hidden
                  >
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-slate-800">
                      <span className="font-semibold text-slate-900">{actorLabel}</span>{' '}
                      <span className="text-slate-700">{human.action}</span>
                    </p>
                    {human.hint ? <p className="mt-0.5 text-[10px] text-slate-500">{human.hint}</p> : null}
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{atLabel}</p>
                  </div>
                  <span className="shrink-0 self-start rounded-md border border-slate-200/80 bg-white/90 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                    Datos técnicos
                  </span>
                </div>
              </summary>
              <div className="mt-3 border-t border-slate-200/80 pt-3 text-[10px] text-slate-500">
                <p className="font-mono text-slate-600">
                  <span className="font-semibold text-slate-700">{entry.operation}</span>
                  {' · '}
                  {entry.sourceTable}
                  {entry.rowId ? (
                    <span className="text-slate-500"> · fila {entry.rowId.slice(0, 8)}…</span>
                  ) : null}
                </p>
                <pre className="mt-2 max-h-[280px] overflow-auto rounded-lg border border-slate-100 bg-slate-950/95 p-3 leading-relaxed text-emerald-100/95">
                  {JSON.stringify(entry.payload, null, 2)}
                </pre>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
