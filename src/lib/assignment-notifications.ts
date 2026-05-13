import type { SupabaseClient } from '@supabase/supabase-js';
import { filterSustanciadoresMatchingAssigned, fetchProfilesByCourtAndRoles } from './profile-notification-recipients';
import { isPostgrestTableMissingError } from './supabase-user-error';

/**
 * Crea filas en `user_notifications` para sustanciadores del mismo juzgado cuyo nombre o email
 * coincide con el texto guardado en `assigned_to`.
 */
export async function insertAssignmentNotificationsForProfiles(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    assignedTo: string;
    actorUserName: string;
  },
): Promise<void> {
  const at = opts.assignedTo.trim();
  if (!at) return;

  const sustanciadores = await fetchProfilesByCourtAndRoles(supabase, opts.courtId, ['sustanciador']);
  const recipients = filterSustanciadoresMatchingAssigned(sustanciadores, at);
  if (recipients.length === 0) {
    console.warn('assignment-notifications: ningún sustanciador coincide con assigned_to:', at);
    return;
  }

  const title = 'Le asignaron un expediente';
  const body = `Radicado ${opts.radicado}. Quien asigna: ${opts.actorUserName}.`;

  for (const r of recipients) {
    const { error: insErr } = await supabase.from('user_notifications').insert({
      court_id: opts.courtId,
      case_id: opts.caseId,
      recipient_user_id: r.id,
      kind: 'case_assigned_sustanciador',
      title,
      body,
      metadata: { radicado: opts.radicado, assigned_to: at },
    });
    if (insErr && !isPostgrestTableMissingError(insErr, 'user_notifications')) {
      console.error('user_notifications insert:', insErr);
    }
  }
}

export async function markAssignmentNotificationsReadForCase(
  supabase: SupabaseClient,
  opts: { caseId: string; recipientUserId: string },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: now })
    .eq('case_id', opts.caseId)
    .eq('recipient_user_id', opts.recipientUserId)
    .is('read_at', null);
  if (error && !isPostgrestTableMissingError(error, 'user_notifications')) {
    console.error('user_notifications mark read:', error);
  }
}
