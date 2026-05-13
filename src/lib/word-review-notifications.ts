import type { SupabaseClient } from '@supabase/supabase-js';
import type { SustanciadorAssignmentMode } from '../types';
import { fetchProfilesByCourtAndRoles, resolveSustanciadorRecipientsForCase } from './profile-notification-recipients';
import { isPostgrestTableMissingError } from './supabase-user-error';

/** Datos del expediente para resolver a quién avisar (sustanciador por rol en `profiles`). */
export type WordReviewSustanciadorNotifyCaseContext = {
  courtId: string;
  radicado: string;
  assignedTo?: string;
  courtAssignmentMode?: SustanciadorAssignmentMode | null;
};

/**
 * Aviso in-app a perfiles con rol `judge` del mismo juzgado cuando hay un Word en revisión.
 */
export async function insertWordReviewJudgeNotifications(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    reviewId: string;
    documentLabel: string;
    actorUserName: string;
  },
): Promise<void> {
  const recipients = await fetchProfilesByCourtAndRoles(supabase, opts.courtId, ['judge']);
  if (recipients.length === 0) {
    console.warn('word_review_pendiente_juez: sin perfiles con rol judge en el juzgado.');
    return;
  }

  const title = 'Documento pendiente de revisión';
  const body = `Radicado ${opts.radicado}: ${opts.documentLabel}. Enviado por ${opts.actorUserName}.`;

  for (const r of recipients) {
    const { error: insErr } = await supabase.from('user_notifications').insert({
      court_id: opts.courtId,
      case_id: opts.caseId,
      recipient_user_id: r.id,
      kind: 'word_review_pendiente_juez',
      title,
      body,
      metadata: {
        radicado: opts.radicado,
        review_id: opts.reviewId,
        document_label: opts.documentLabel,
      },
    });
    if (insErr && !isPostgrestTableMissingError(insErr, 'user_notifications')) {
      console.error('user_notifications insert (word review):', insErr);
    }
  }
}

/**
 * Aviso in-app al sustanciador cuando el juez devuelve el borrador con observaciones (`observaciones_juez`).
 */
export async function insertWordReviewSustanciadorNotifications(
  supabase: SupabaseClient,
  opts: {
    caseContext: WordReviewSustanciadorNotifyCaseContext;
    caseId: string;
    reviewId: string;
    documentLabel: string;
    actorUserName: string;
    /** Usuario que creó el ciclo de revisión (p. ej. quien subió el Word); si es sustanciador, recibe el aviso. */
    reviewCreatedBy?: string;
  },
): Promise<void> {
  const { courtId, radicado, assignedTo, courtAssignmentMode } = opts.caseContext;
  const recipients = await resolveSustanciadorRecipientsForCase(supabase, {
    courtId,
    caseId: opts.caseId,
    assignedTo,
    courtAssignmentMode,
    reviewCreatedBy: opts.reviewCreatedBy,
  });
  if (recipients.length === 0) {
    console.warn(
      'word_review_observaciones_juez: sin destinatario (sin sustanciadores en el juzgado, manual_unassigned o sin coincidencia con assigned_to).',
    );
    return;
  }

  const title = 'Borrador devuelto con observaciones';
  const body = `Radicado ${radicado}: ${opts.documentLabel}. Devuelto por ${opts.actorUserName}. Revise «Documentos por revisar» en el expediente.`;

  for (const r of recipients) {
    const { error: insErr } = await supabase.from('user_notifications').insert({
      court_id: courtId,
      case_id: opts.caseId,
      recipient_user_id: r.id,
      kind: 'word_review_observaciones_juez',
      title,
      body,
      metadata: {
        radicado,
        review_id: opts.reviewId,
        document_label: opts.documentLabel,
      },
    });
    if (insErr && !isPostgrestTableMissingError(insErr, 'user_notifications')) {
      console.error('user_notifications insert (word review observaciones):', insErr);
    }
  }
}
