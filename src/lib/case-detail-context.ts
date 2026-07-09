import type { Action, Case, Document, SustanciadorAssignmentMode } from '../types';
import { plazoFallarLabelForCase } from './decreto-2591-plazos';
import { resolveAssigneeForCase } from './court-staff-assignees';
import { sanitizeExpedienteFilenameForDisplay } from './sanitize-expediente-filename';
import { caseDocumentRawLabel } from './case-document-display-name';

export type CaseTimelineEntry = {
  key: string;
  at: string;
  title: string;
  subtitle?: string;
  actor?: string;
  kind: 'system' | 'document' | 'action';
};

function tsOrFallback(iso: string | undefined, fallback: string): string {
  if (!iso?.trim()) return fallback;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback : iso;
}

/** Texto auxiliar para el prompt de síntesis IA (plazos, piezas, asignación). */
export function buildSynthesisContextBlock(
  caseItem: Case,
  docs: Document[],
  courtAssignmentMode?: SustanciadorAssignmentMode | null
): string {
  const assignee = resolveAssigneeForCase(caseItem.assignedTo, caseItem.id, courtAssignmentMode);
  const formal = caseItem.assignedTo?.trim();
  const assignLine = formal
    ? `Sustanciador asignado (campo assigned_to): ${formal} (reparto efectivo mostrado al usuario: ${assignee.name})`
    : courtAssignmentMode === 'manual_unassigned'
      ? 'Sustanciador: sin asignación persistida (modo manual del juzgado).'
      : `Sustanciador (mostrado en UI): ${assignee.name} — si falta assigned_to, se usa regla por defecto del despacho.`;

  const titles = docs.map((d) => {
    const raw = caseDocumentRawLabel(d);
    return raw ? sanitizeExpedienteFilenameForDisplay(raw) : 'Sin nombre';
  });

  const plazoLabel = plazoFallarLabelForCase(caseItem.caseType);
  const deadlineLine = plazoLabel
    ? caseItem.deadlineAt?.trim()
      ? `${plazoLabel} (deadline_at, ISO): ${caseItem.deadlineAt}`
      : `${plazoLabel}: no registrado (deadline_at vacío).`
    : null;

  const lines = [
    `Accionado: ${caseItem.defendant}`,
    `Estado judicial (status): ${caseItem.status}`,
    caseItem.operationalStatus?.trim()
      ? `Estado operativo (tablero / gestión): ${caseItem.operationalStatus}`
      : 'Estado operativo: no indicado.',
    ...(deadlineLine ? [deadlineLine] : []),
    assignLine,
    titles.length > 0
      ? `Piezas en expediente digital (${titles.length}): ${titles.join(' · ')}`
      : 'Expediente digital: aún sin piezas listadas.',
  ];
  return lines.join('\n');
}

/**
 * Solo actuaciones del despacho (`case_actions`) más el hito de ingreso al sistema.
 * La trazabilidad técnica completa (cada cambio en BD) vive en `case_audit_log` (pestaña Historial).
 */
export function buildCaseActuacionesTimeline(caseItem: Case, actions: Action[]): CaseTimelineEntry[] {
  const base = tsOrFallback(caseItem.createdAt, new Date().toISOString());
  const rows: CaseTimelineEntry[] = [
    {
      key: 'sys-created',
      at: base,
      title: 'Expediente incorporado al sistema',
      subtitle: `Radicado ${caseItem.radicado}`,
      kind: 'system',
    },
  ];

  for (const a of actions) {
    rows.push({
      key: `act-${a.id}`,
      at: tsOrFallback(a.timestamp, base),
      title: a.description,
      actor: a.userName || undefined,
      kind: 'action',
    });
  }

  rows.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return rows;
}

/** Línea de tiempo mixta (sistema + piezas + actuaciones); preferir `buildCaseActuacionesTimeline` en UI de actuaciones. */
export function buildCaseTimeline(caseItem: Case, docs: Document[], actions: Action[]): CaseTimelineEntry[] {
  const base = tsOrFallback(caseItem.createdAt, new Date().toISOString());
  const rows: CaseTimelineEntry[] = [];

  rows.push({
    key: 'sys-created',
    at: tsOrFallback(caseItem.createdAt, base),
    title: 'Expediente registrado en el sistema',
    subtitle: `Radicado ${caseItem.radicado}`,
    kind: 'system',
  });

  if (caseItem.deadlineAt?.trim() && plazoFallarLabelForCase(caseItem.caseType)) {
    const at = tsOrFallback(caseItem.deadlineAt, base);
    rows.push({
      key: 'sys-deadline',
      at,
      title: 'Plazo o término relevante',
      subtitle:
        'Use este dato para traslados, contestación del accionado y seguimiento; confirme en autos si difiere.',
      kind: 'system',
    });
  }

  if (caseItem.operationalStatus?.trim()) {
    rows.push({
      key: 'sys-operational',
      at: tsOrFallback(caseItem.updatedAt, caseItem.createdAt),
      title: `Estado operativo: ${caseItem.operationalStatus}`,
      kind: 'system',
    });
  }

  for (const d of docs) {
    const raw = caseDocumentRawLabel(d);
    const label = raw ? sanitizeExpedienteFilenameForDisplay(raw) : 'Documento sin nombre';
    rows.push({
      key: `doc-${d.id}`,
      at: tsOrFallback(d.createdAt, base),
      title: `Pieza en expediente: ${label}`,
      subtitle:
        d.type === 'email_body'
          ? 'Constancia de ingreso'
          : d.type === 'expediente_upload'
            ? 'Carga al expediente'
            : d.ingestError
              ? 'Carga incompleta'
              : undefined,
      kind: 'document',
    });
  }

  for (const a of actions) {
    rows.push({
      key: `act-${a.id}`,
      at: tsOrFallback(a.timestamp, base),
      title: a.description,
      actor: a.userName || undefined,
      kind: 'action',
    });
  }

  rows.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return rows;
}
