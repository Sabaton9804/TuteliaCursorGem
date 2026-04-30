import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assignedToMatchesProfile,
  findStaffByAssignedValue,
  normalizeStaffKey,
} from './court-staff-assignees';
import { isPostgrestTableMissingError } from './supabase-user-error';

/**
 * Crea filas en `user_notifications` para perfiles del mismo juzgado cuyo nombre o email
 * coincide con el texto guardado en `assigned_to` (nombre del sustanciador o correo seed).
 */
export async function insertAssignmentNotificationsForProfiles(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    assignedTo: string;
    actorUserName: string;
  }
): Promise<void> {
  const at = opts.assignedTo.trim();
  if (!at) return;

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('court_id', opts.courtId);
  if (error) {
    console.error('assignment-notifications profiles:', error);
    return;
  }

  const staff = findStaffByAssignedValue(at);
  const recipients = (profiles || []).filter((p) => {
    if (assignedToMatchesProfile(at, p.name)) return true;
    const em = (p.email || '').trim();
    if (!em || !staff?.emails?.length) return false;
    return staff.emails.some((e) => normalizeStaffKey(e) === normalizeStaffKey(em));
  });

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
  opts: { caseId: string; recipientUserId: string }
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
