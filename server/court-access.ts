import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuthenticatedCaller } from './outlook-auth';
import { parseUserRole } from '../src/lib/user-roles.ts';
import type { UserRole } from '../src/types.ts';
import { hasRoleCapability, type RoleCapability } from '../src/lib/role-capabilities.ts';

export type CaseAccessRow = {
  id: string;
  court_id: string;
  radicado: string | null;
  sgde_id: string | null;
};

/** Platform admin o superuser: acceso a cualquier despacho (operaciones servidor). */
export async function isPlatformWideCourtBypass(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: prof, error } = await admin
    .from('profiles')
    .select('is_superuser')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (prof?.is_superuser === true) return true;

  const { data: plat } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(plat?.user_id);
}

/** Membresía M:N, perfil legacy o bypass plataforma. */
export async function userHasCourtAccess(
  admin: SupabaseClient,
  userId: string,
  courtId: string,
): Promise<boolean> {
  const trimmed = String(courtId || '').trim();
  if (!trimmed) return false;

  if (await isPlatformWideCourtBypass(admin, userId)) return true;

  const { data: memb, error: memErr } = await admin
    .from('profile_court_memberships')
    .select('id')
    .eq('profile_id', userId)
    .eq('court_id', trimmed)
    .maybeSingle();
  if (memErr) throw memErr;
  if (memb?.id) return true;

  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('court_id')
    .eq('id', userId)
    .maybeSingle();
  if (profErr) throw profErr;
  return String(prof?.court_id || '') === trimmed;
}

/** Rol efectivo en un despacho (membresía M:N o perfil legacy). */
export async function resolveCallerRoleForCourt(
  admin: SupabaseClient,
  userId: string,
  courtId: string,
): Promise<UserRole | null> {
  const trimmed = String(courtId || '').trim();
  if (!trimmed) return null;

  const { data: memb } = await admin
    .from('profile_court_memberships')
    .select('role')
    .eq('profile_id', userId)
    .eq('court_id', trimmed)
    .maybeSingle();
  if (memb?.role) return parseUserRole(memb.role);

  const { data: prof } = await admin
    .from('profiles')
    .select('role, court_id')
    .eq('id', userId)
    .maybeSingle();
  if (prof && String(prof.court_id) === trimmed && prof.role) {
    return parseUserRole(prof.role);
  }
  if (prof?.role) return parseUserRole(prof.role);
  return null;
}

export async function requireCourtAccess(
  req: Request,
  getSupabaseAdmin: () => SupabaseClient,
  courtIdParam: string,
): Promise<
  | { ok: true; admin: SupabaseClient; userId: string; courtId: string; role: UserRole | null }
  | { ok: false; status: number; message: string }
> {
  const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
  if (auth.ok === false) {
    return { ok: false, status: auth.status, message: auth.message };
  }
  const courtId = String(courtIdParam || '').trim();
  if (!courtId) {
    return { ok: false, status: 400, message: 'courtId requerido.' };
  }
  const allowed = await userHasCourtAccess(auth.admin, auth.userId, courtId);
  if (!allowed) {
    return { ok: false, status: 403, message: 'No autorizado para este despacho.' };
  }
  const role = await resolveCallerRoleForCourt(auth.admin, auth.userId, courtId);
  return { ok: true, admin: auth.admin, userId: auth.userId, courtId, role };
}

export async function requireCaseAccess(
  req: Request,
  getSupabaseAdmin: () => SupabaseClient,
  caseId: string,
): Promise<
  | { ok: true; admin: SupabaseClient; userId: string; caseRow: CaseAccessRow; role: UserRole | null }
  | { ok: false; status: number; message: string }
> {
  const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
  if (auth.ok === false) {
    return { ok: false, status: auth.status, message: auth.message };
  }
  const cid = String(caseId || '').trim();
  if (!cid) {
    return { ok: false, status: 400, message: 'caseId requerido.' };
  }
  const { data: row, error: caseErr } = await auth.admin
    .from('cases')
    .select('id, court_id, radicado, sgde_id')
    .eq('id', cid)
    .maybeSingle();
  if (caseErr || !row?.id) {
    return { ok: false, status: 404, message: 'Expediente no encontrado.' };
  }
  const courtId = String(row.court_id);
  const allowed = await userHasCourtAccess(auth.admin, auth.userId, courtId);
  if (!allowed) {
    return { ok: false, status: 403, message: 'No autorizado para este expediente.' };
  }
  const role = await resolveCallerRoleForCourt(auth.admin, auth.userId, courtId);
  return {
    ok: true,
    admin: auth.admin,
    userId: auth.userId,
    role,
    caseRow: {
      id: String(row.id),
      court_id: courtId,
      radicado: row.radicado != null ? String(row.radicado) : null,
      sgde_id: row.sgde_id != null ? String(row.sgde_id) : null,
    },
  };
}

export async function requireCourtCapability(
  req: Request,
  getSupabaseAdmin: () => SupabaseClient,
  courtId: string,
  capability: RoleCapability,
): Promise<
  | { ok: true; admin: SupabaseClient; userId: string; courtId: string; role: UserRole }
  | { ok: false; status: number; message: string }
> {
  const acc = await requireCourtAccess(req, getSupabaseAdmin, courtId);
  if (acc.ok === false) return acc;
  const role = acc.role ?? 'clerk';
  if (!hasRoleCapability(role, capability)) {
    return { ok: false, status: 403, message: 'Su rol no tiene permiso para esta operación.' };
  }
  return { ok: true, admin: acc.admin, userId: acc.userId, courtId: acc.courtId, role };
}

export async function resolveDefaultCourtId(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: defMem } = await admin
    .from('profile_court_memberships')
    .select('court_id')
    .eq('profile_id', userId)
    .eq('is_default', true)
    .maybeSingle();
  if (defMem?.court_id) return String(defMem.court_id);

  const { data: anyMem } = await admin
    .from('profile_court_memberships')
    .select('court_id')
    .eq('profile_id', userId)
    .limit(1)
    .maybeSingle();
  if (anyMem?.court_id) return String(anyMem.court_id);

  const { data: prof } = await admin.from('profiles').select('court_id').eq('id', userId).maybeSingle();
  return prof?.court_id ? String(prof.court_id) : null;
}

export async function assertCaseCourtAccess(
  admin: SupabaseClient,
  userId: string,
  caseCourtId: string,
): Promise<string | null> {
  const ok = await userHasCourtAccess(admin, userId, caseCourtId);
  return ok ? null : 'No autorizado para este expediente.';
}
