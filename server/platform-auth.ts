import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuthenticatedCaller, type AuthenticatedCaller } from './outlook-auth';

export type PlatformOperatorCaller =
  | {
      ok: true;
      admin: SupabaseClient;
      userId: string;
      email: string | null;
      isFullAdmin: boolean;
      territoryIds: string[];
    }
  | { ok: false; status: number; message: string };

async function loadOperatorScope(
  admin: SupabaseClient,
  userId: string
): Promise<{ isFullAdmin: boolean; territoryIds: string[] }> {
  const { data: adminRow } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (adminRow?.user_id) {
    return { isFullAdmin: true, territoryIds: [] };
  }

  const { data: prof } = await admin
    .from('profiles')
    .select('is_superuser')
    .eq('id', userId)
    .maybeSingle();

  if (prof?.is_superuser === true) {
    return { isFullAdmin: true, territoryIds: [] };
  }

  const { data: regionalRows } = await admin
    .from('platform_regional_admins')
    .select('territory_id')
    .eq('user_id', userId);

  const territoryIds = (regionalRows ?? [])
    .map((r) => String(r.territory_id))
    .filter(Boolean);

  return { isFullAdmin: false, territoryIds };
}

export async function requirePlatformOperator(
  req: Request,
  getSupabaseAdmin: () => SupabaseClient
): Promise<PlatformOperatorCaller> {
  const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
  if (auth.ok === false) {
    return { ok: false, status: auth.status, message: auth.message };
  }

  const scope = await loadOperatorScope(auth.admin, auth.userId);
  if (!scope.isFullAdmin && scope.territoryIds.length === 0) {
    return {
      ok: false,
      status: 403,
      message: 'Se requiere administrador de plataforma o alcance regional.',
    };
  }

  return {
    ok: true,
    admin: auth.admin,
    userId: auth.userId,
    email: auth.email,
    isFullAdmin: scope.isFullAdmin,
    territoryIds: scope.territoryIds,
  };
}

export async function requirePlatformAdmin(
  req: Request,
  getSupabaseAdmin: () => SupabaseClient
): Promise<PlatformOperatorCaller> {
  const op = await requirePlatformOperator(req, getSupabaseAdmin);
  if (op.ok === false) return op;
  if (!op.isFullAdmin) {
    return { ok: false, status: 403, message: 'Se requiere administrador nacional de plataforma.' };
  }
  return op;
}

export function assertTerritoryScope(
  op: Extract<PlatformOperatorCaller, { ok: true }>,
  territoryId: string | null | undefined
): string | null {
  if (op.isFullAdmin) return null;
  if (!territoryId?.trim()) {
    return 'territory_id es requerido para operadores regionales';
  }
  if (!op.territoryIds.includes(territoryId.trim())) {
    return 'Sin permiso para este territorio';
  }
  return null;
}

export async function assertCourtScope(
  op: Extract<PlatformOperatorCaller, { ok: true }>,
  courtId: string
): Promise<string | null> {
  if (op.isFullAdmin) return null;
  const { data: court } = await op.admin
    .from('courts')
    .select('territory_id')
    .eq('id', courtId)
    .maybeSingle();
  if (!court?.territory_id) {
    return 'Despacho sin territorio asignado';
  }
  return assertTerritoryScope(op, String(court.territory_id));
}

export type { AuthenticatedCaller };
