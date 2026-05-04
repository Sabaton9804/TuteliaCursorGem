import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DESPACHO_STAFF,
  assignedToMatchesProfile,
  normalizeStaffKey,
} from './court-staff-assignees';
import { isPostgrestTableMissingError } from './supabase-user-error';

/**
 * Aviso in-app al juez del organigrama seed (mismo criterio que asignaciones) cuando hay un Word en revisión.
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
  const judge = DESPACHO_STAFF.find((p) => p.courtRole === 'judge');
  if (!judge) return;

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('court_id', opts.courtId);
  if (error) {
    console.error('word-review-notifications profiles:', error);
    return;
  }

  const recipients = (profiles || []).filter((p) => {
    if (assignedToMatchesProfile(judge.name, p.name)) return true;
    const em = (p.email || '').trim();
    if (!em || !judge.emails?.length) return false;
    return judge.emails.some((e) => normalizeStaffKey(e) === normalizeStaffKey(em));
  });

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
