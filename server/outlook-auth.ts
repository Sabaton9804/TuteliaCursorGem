import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOutlookStateSecret } from './outlook-config';

export type AuthenticatedCaller =
  | { ok: true; admin: SupabaseClient; userId: string; email: string | null }
  | { ok: false; status: number; message: string };

export function signOutlookOAuthState(userId: string): string {
  const payload = JSON.stringify({
    userId,
    n: randomBytes(16).toString('hex'),
    exp: Date.now() + 15 * 60 * 1000,
  });
  const secret = getOutlookStateSecret();
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(JSON.stringify({ p: payload, s: sig })).toString('base64url');
}

export function verifyOutlookOAuthState(state: string): string | null {
  try {
    const raw = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { p?: string; s?: string };
    if (!raw?.p || !raw?.s) return null;
    const expected = createHmac('sha256', getOutlookStateSecret()).update(raw.p).digest('base64url');
    const a = Buffer.from(raw.s);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(raw.p) as { userId?: string; exp?: number };
    if (!parsed.userId || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return parsed.userId;
  } catch {
    return null;
  }
}

export async function requireAuthenticatedCaller(
  req: Request,
  getSupabaseAdmin: () => SupabaseClient
): Promise<AuthenticatedCaller> {
  const authHdr = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(authHdr);
  const token = m?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, message: 'Se requiere sesión (Authorization: Bearer).' };
  }
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    return {
      ok: false,
      status: 503,
      message: String((e as Error)?.message || 'Supabase no configurado en servidor.'),
    };
  }
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user?.id) {
    return { ok: false, status: 401, message: 'Sesión inválida o expirada.' };
  }
  return {
    ok: true,
    admin,
    userId: authData.user.id,
    email: authData.user.email ?? null,
  };
}
