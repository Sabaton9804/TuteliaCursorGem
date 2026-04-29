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
  if (sess.session?.user) return;

  const { data: jwtUser } = await supabase.auth.getUser();
  if (jwtUser.user) return;

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
