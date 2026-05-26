import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient } from './sgde-client';
import { createLoggedInSgdeClientForUser } from './sgde-integration';

const TTL_MS = 8 * 60 * 1000;

type Cached = {
  client: SgdeClient;
  portalBaseUrl: string;
  expiresAt: number;
};

const byUser = new Map<string, Cached>();

export function invalidateSgdeSession(userId: string): void {
  byUser.delete(userId);
}

/** Reutiliza sesión SGDE del usuario (~8 min) para no repetir login en cada vista previa. */
export async function getLoggedInSgdeClientForUser(
  admin: SupabaseClient,
  userId: string
): Promise<{ client: SgdeClient; portalBaseUrl: string } | { error: string; code?: string }> {
  const now = Date.now();
  const hit = byUser.get(userId);
  if (hit && hit.expiresAt > now) {
    return { client: hit.client, portalBaseUrl: hit.portalBaseUrl };
  }
  byUser.delete(userId);

  const logged = await createLoggedInSgdeClientForUser(admin, userId);
  if ('error' in logged) return logged;

  byUser.set(userId, {
    client: logged.client,
    portalBaseUrl: logged.portalBaseUrl,
    expiresAt: now + TTL_MS,
  });
  return logged;
}
