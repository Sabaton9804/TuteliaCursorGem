import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '../types';
import { isPostgrestTableMissingError } from './supabase-user-error';
import { fetchProfilesByCourtAndRoles } from './profile-notification-recipients';
import type { CaseStageCode } from './case-workflow-stages';

const SECRETARIA_NOTIFICATION_ROLES: UserRole[] = ['clerk', 'escribiente', 'official', 'asistente_judicial'];
const ENCARGADO_REMISION_ROLES: UserRole[] = ['official', 'asistente_judicial'];

async function insertNotificationRows(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    recipientIds: string[];
    kind: string;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  for (const recipient_user_id of opts.recipientIds) {
    const { error: insErr } = await supabase.from('user_notifications').insert({
      court_id: opts.courtId,
      case_id: opts.caseId,
      recipient_user_id,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      metadata: opts.metadata,
    });
    if (insErr && !isPostgrestTableMissingError(insErr, 'user_notifications')) {
      console.error('user_notifications insert (workflow stage):', insErr);
    }
  }
}

/**
 * Avisos in-app al **entrar** en una etapa del carril (tras insertar `case_stages`).
 */
export async function insertWorkflowStageEntryNotifications(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    enteredStage: CaseStageCode;
  },
): Promise<void> {
  const rad = opts.radicado.trim() || '—';

  switch (opts.enteredStage) {
    case 'ADMISION': {
      const profiles = await fetchProfilesByCourtAndRoles(
        supabase,
        opts.courtId,
        SECRETARIA_NOTIFICATION_ROLES,
      );
      const title = `Auto admisorio firmado — ${rad} — Generar y enviar oficios de notificación`;
      const body =
        'El juez aprobó el auto admisorio. Prepare los oficios, envíelos por correo a las partes y registre «Notificación enviada» en el expediente.';
      await insertNotificationRows(supabase, {
        courtId: opts.courtId,
        caseId: opts.caseId,
        recipientIds: profiles.map((p) => p.id),
        kind: 'workflow_notificacion_auto_admisorio',
        title,
        body,
        metadata: { radicado: rad, stage_code: opts.enteredStage },
      });
      break;
    }
    case 'FALLO': {
      const profiles = await fetchProfilesByCourtAndRoles(
        supabase,
        opts.courtId,
        SECRETARIA_NOTIFICATION_ROLES,
      );
      const title = `Fallo firmado — ${rad} — Generar y enviar oficios de notificación`;
      const body =
        'El juez aprobó el fallo. Prepare los oficios de notificación, envíelos por correo y registre «Notificación del fallo enviada» en el expediente.';
      await insertNotificationRows(supabase, {
        courtId: opts.courtId,
        caseId: opts.caseId,
        recipientIds: profiles.map((p) => p.id),
        kind: 'workflow_notificacion_fallo',
        title,
        body,
        metadata: { radicado: rad, stage_code: opts.enteredStage },
      });
      break;
    }
    case 'TERMINO_RESPUESTA': {
      const profiles = await fetchProfilesByCourtAndRoles(supabase, opts.courtId, ['sustanciador']);
      const title = `Plazo de contestación (2 días hábiles) — ${rad}`;
      const body =
        'Las partes pueden contestar tras la notificación del auto. Monitoree vencimiento; al vencer pasa a ingreso para fallo.';
      await insertNotificationRows(supabase, {
        courtId: opts.courtId,
        caseId: opts.caseId,
        recipientIds: profiles.map((p) => p.id),
        kind: 'workflow_termino_contestacion',
        title,
        body,
        metadata: { radicado: rad, stage_code: opts.enteredStage },
      });
      break;
    }
    case 'TERMINO_IMPUGNACION': {
      const profiles = await fetchProfilesByCourtAndRoles(
        supabase,
        opts.courtId,
        SECRETARIA_NOTIFICATION_ROLES,
      );
      const title = `Plazo de impugnación (3 días hábiles, art. 31 D.2591/91) — ${rad}`;
      const body =
        'Tras notificar el fallo. Registre impugnación o espere vencimiento para ejecutoria (art. 31 Decreto 2591/1991).';
      await insertNotificationRows(supabase, {
        courtId: opts.courtId,
        caseId: opts.caseId,
        recipientIds: profiles.map((p) => p.id),
        kind: 'workflow_termino_impugnacion',
        title,
        body,
        metadata: { radicado: rad, stage_code: opts.enteredStage },
      });
      break;
    }
    case 'INGRESO_DESPACHO_FALLO': {
      const profiles = await fetchProfilesByCourtAndRoles(supabase, opts.courtId, ['sustanciador']);
      const title = `Expediente listo para proyección de fallo — ${rad}`;
      const body = 'Revise el expediente y las tareas del flujo.';
      await insertNotificationRows(supabase, {
        courtId: opts.courtId,
        caseId: opts.caseId,
        recipientIds: profiles.map((p) => p.id),
        kind: 'workflow_ingreso_despacho_fallo',
        title,
        body,
        metadata: { radicado: rad, stage_code: opts.enteredStage },
      });
      break;
    }
    case 'REMISION_CORTE': {
      const profiles = await fetchProfilesByCourtAndRoles(supabase, opts.courtId, ENCARGADO_REMISION_ROLES);
      const title = `Pendiente remisión a Corte Constitucional — ${rad} — 10 días hábiles (art. 32 D.2591/91)`;
      const body =
        'Dentro de los 10 días hábiles siguientes a la ejecutoria del fallo de segunda instancia (art. 32 Decreto 2591/1991).';
      await insertNotificationRows(supabase, {
        courtId: opts.courtId,
        caseId: opts.caseId,
        recipientIds: profiles.map((p) => p.id),
        kind: 'workflow_remision_corte',
        title,
        body,
        metadata: { radicado: rad, stage_code: opts.enteredStage },
      });
      break;
    }
    default:
      break;
  }
}

/** Al iniciar incidente de desacato: avisar a sustanciadores del juzgado. */
export async function insertIncidenteDesacatoIniciadoNotifications(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    incidentId: string;
  },
): Promise<void> {
  const rad = opts.radicado.trim() || '—';
  const profiles = await fetchProfilesByCourtAndRoles(supabase, opts.courtId, ['sustanciador']);
  const title = `Incidente de desacato iniciado — ${rad} — Requiere proyección de auto`;
  const body = 'Revise el expediente y la tarea asociada al incidente.';
  await insertNotificationRows(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    recipientIds: profiles.map((p) => p.id),
    kind: 'incidente_desacato_iniciado',
    title,
    body,
    metadata: { radicado: rad, incident_desacato_id: opts.incidentId },
  });
}
