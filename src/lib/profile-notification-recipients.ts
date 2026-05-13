import type { SupabaseClient } from '@supabase/supabase-js';
import type { SustanciadorAssignmentMode, UserRole } from '../types';
import { assignedToMatchesProfile, normalizeStaffKey } from './court-staff-assignees';

export type ProfileNotifyRow = { id: string; name: string; email: string | null; role: UserRole };

function hashPickIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % modulo;
}

function emailMatchesAssigned(assignedTo: string, email: string | null | undefined): boolean {
  const raw = assignedTo.trim();
  if (!raw.includes('@')) return false;
  const em = (email || '').trim();
  if (!em) return false;
  return normalizeStaffKey(raw) === normalizeStaffKey(em);
}

/**
 * Perfiles del juzgado cuyo `role` está en la lista (p. ej. notificaciones por rol, sin depender del seed del organigrama).
 */
export async function fetchProfilesByCourtAndRoles(
  supabase: SupabaseClient,
  courtId: string,
  roles: readonly UserRole[],
): Promise<ProfileNotifyRow[]> {
  const set = new Set(roles);
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('court_id', courtId);
  if (error) {
    console.error('profile-notification-recipients profiles:', error);
    return [];
  }
  return ((data ?? []) as ProfileNotifyRow[]).filter((p) => set.has(p.role));
}

/**
 * Sustanciadores destinatarios para revisión Word / asignación: creador del ciclo, coincidencia con `assigned_to`, o reparto estable entre sustanciadores del juzgado.
 */
export async function resolveSustanciadorRecipientsForCase(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    assignedTo?: string;
    courtAssignmentMode?: SustanciadorAssignmentMode | null;
    reviewCreatedBy?: string;
  },
): Promise<ProfileNotifyRow[]> {
  const sustanciadores = await fetchProfilesByCourtAndRoles(supabase, opts.courtId, ['sustanciador']);
  if (sustanciadores.length === 0) return [];

  if (opts.reviewCreatedBy?.trim()) {
    const { data: creator, error: cErr } = await supabase
      .from('profiles')
      .select('id, name, email, role, court_id')
      .eq('id', opts.reviewCreatedBy.trim())
      .maybeSingle();
    if (!cErr && creator && String((creator as Record<string, unknown>).court_id) === opts.courtId) {
      const role = String((creator as Record<string, unknown>).role ?? '') as UserRole;
      if (role === 'sustanciador') {
        return [
          {
            id: String((creator as Record<string, unknown>).id),
            name: String((creator as Record<string, unknown>).name ?? ''),
            email: ((creator as Record<string, unknown>).email as string | null) ?? null,
            role: 'sustanciador',
          },
        ];
      }
    }
  }

  const raw = opts.assignedTo?.trim();
  if (raw) {
    const hits = sustanciadores.filter(
      (p) => assignedToMatchesProfile(raw, p.name) || emailMatchesAssigned(raw, p.email),
    );
    if (hits.length > 0) return hits;
    return [];
  }

  if (opts.courtAssignmentMode === 'manual_unassigned') {
    return [];
  }

  const ordered = [...sustanciadores].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
  const idx = hashPickIndex(opts.caseId, ordered.length);
  return [ordered[idx]!];
}

/**
 * Perfiles con rol `sustanciador` que coinciden con el texto de asignación (nombre o email en el texto).
 */
export function filterSustanciadoresMatchingAssigned(
  sustanciadores: ProfileNotifyRow[],
  assignedTo: string,
): ProfileNotifyRow[] {
  const at = assignedTo.trim();
  if (!at) return [];
  return sustanciadores.filter(
    (p) => assignedToMatchesProfile(at, p.name) || emailMatchesAssigned(at, p.email),
  );
}
