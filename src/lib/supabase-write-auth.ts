import { supabase } from './supabase';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD } from './dev-admin-auth';
import { isLocalSupabaseAnonymousDisabled } from './supabase-auth-errors';

/**
 * Garantiza un JWT de Supabase antes de INSERT/UPDATE.
 * Sesión por contraseña u OAuth ya en almacenamiento → no hace nada.
 * Si no hay sesión, intenta anónimo; en desarrollo, si Anonymous está apagado, intenta el usuario dev de Auth.
 */
export async function ensureSupabaseSessionForWrites(): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  if (sess.session?.access_token) return;

  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) return;

  const { error: anonErr } = await supabase.auth.signInAnonymously();
  if (!anonErr) return;

  if (import.meta.env.DEV && isLocalSupabaseAnonymousDisabled(anonErr)) {
    const { error: pwErr } = await supabase.auth.signInWithPassword({
      email: DEV_ADMIN_EMAIL,
      password: DEV_ADMIN_PASSWORD,
    });
    if (!pwErr) return;
    throw pwErr;
  }

  throw anonErr;
}

/** Headers Authorization: Bearer para APIs Express locales (`/api/parse-email`, SGDE, IA…). */
export async function apiAuthHeaders(opts?: {
  /** Si true, añade Content-Type: application/json. Omitir con FormData. */
  json?: boolean;
}): Promise<Record<string, string>> {
  await ensureSupabaseSessionForWrites();
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token ?? undefined;
  }
  if (!token) {
    throw new Error(
      'No hay sesión activa. Cierre sesión e ingrese de nuevo (admin/admin o su usuario del despacho).',
    );
  }
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (opts?.json) {
    h['Content-Type'] = 'application/json';
  }
  return h;
}
