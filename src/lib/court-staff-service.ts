import { supabase } from './supabase';
import { rowToUserProfile } from './supabase-mappers';
import type { UserProfile, UserRole } from '../types';
import type { ExpedienteAssignee } from './court-staff-types';
import { DEMO_DESPACHO_STAFF } from './court-staff-demo-seed';
import { setCourtStaffCache } from './court-staff-cache';

const STAFF_PALETTE: readonly { ring: string; bg: string; text: string }[] = [
  { ring: 'ring-violet-200', bg: 'bg-violet-100', text: 'text-violet-900' },
  { ring: 'ring-blue-200', bg: 'bg-blue-100', text: 'text-blue-800' },
  { ring: 'ring-emerald-200', bg: 'bg-emerald-100', text: 'text-emerald-900' },
  { ring: 'ring-teal-200', bg: 'bg-teal-100', text: 'text-teal-900' },
  { ring: 'ring-amber-200', bg: 'bg-amber-100', text: 'text-amber-900' },
  { ring: 'ring-orange-200', bg: 'bg-orange-100', text: 'text-orange-900' },
  { ring: 'ring-slate-300', bg: 'bg-slate-200', text: 'text-slate-800' },
  { ring: 'ring-rose-200', bg: 'bg-rose-100', text: 'text-rose-900' },
];

export { setCourtStaffCache, getCachedCourtStaff, getCachedSustanciadores, getCachedNameByRole } from './court-staff-cache';

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return '—';
}

function slugFromProfile(id: string, email: string): string {
  const base = email.split('@')[0]?.trim() || id.slice(0, 8);
  return base
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function profileToAssignee(profile: UserProfile, index: number): ExpedienteAssignee {
  const palette = STAFF_PALETTE[index % STAFF_PALETTE.length];
  const name = profile.name?.trim() || profile.email?.trim() || 'Funcionario';
  return {
    id: slugFromProfile(profile.id, profile.email || profile.id),
    initials: initialsFromName(name),
    name,
    ring: palette.ring,
    bg: palette.bg,
    text: palette.text,
    emails: profile.email?.trim() ? [profile.email.trim()] : [],
    courtRole: profile.role,
    profileId: profile.id,
  };
}

export function filterSustanciadoresFromStaff(staff: readonly ExpedienteAssignee[]): ExpedienteAssignee[] {
  return staff.filter((p) => p.courtRole === 'sustanciador');
}

export async function fetchCourtTeamProfiles(courtId: string): Promise<UserProfile[]> {
  const { data: rpcRows, error: rpcErr } = await supabase.rpc('court_team_members');
  if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length > 0) {
    return (rpcRows as Record<string, unknown>[]).map((r) => rowToUserProfile(r));
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('court_id', courtId)
    .order('name', { ascending: true });

  if (error) {
    console.warn('[court-staff-service] fetch profiles:', error.message);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map((r) => rowToUserProfile(r));
}

export async function fetchCourtStaffAssignees(courtId: string): Promise<{
  staff: ExpedienteAssignee[];
  sustanciadores: ExpedienteAssignee[];
}> {
  const profiles = await fetchCourtTeamProfiles(courtId);
  if (!profiles.length) {
    return {
      staff: [...DEMO_DESPACHO_STAFF],
      sustanciadores: filterSustanciadoresFromStaff(DEMO_DESPACHO_STAFF),
    };
  }
  const staff = profiles.map((p, i) => profileToAssignee(p, i));
  const sustanciadores = filterSustanciadoresFromStaff(staff);
  return { staff, sustanciadores };
}
