import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from '../types';

/**
 * RLS en `cases` exige fila en `profiles` con el mismo `court_id` que el expediente.
 * Falla antes del INSERT con un mensaje accionable si falta perfil o no coincide el despacho.
 */
export async function assertRadicacionProfileAccess(
  supabase: SupabaseClient,
  userId: string,
  courtId: string,
  sessionProfile: UserProfile | null
): Promise<void> {
  if (userId.startsWith('local-')) {
    throw new Error(
      'Está en modo local sin Supabase Auth (id local-…). Cierre sesión, ejecute npm run seed:dev-admin en la raíz del proyecto e inicie de nuevo con usuario admin y contraseña admin.'
    );
  }

  if (sessionProfile?.isSuperuser) return;

  let profileCourtId = sessionProfile?.courtId?.trim() || '';

  if (!profileCourtId) {
    const { data: row, error } = await supabase
      .from('profiles')
      .select('court_id, is_superuser')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (row?.is_superuser === true) return;
    if (!row?.court_id) {
      throw new Error(
        'No hay perfil en Supabase para su usuario (tabla public.profiles). ' +
          'Cierre sesión, vuelva a entrar con Google o ejecute npm run seed:dev-admin. ' +
          'Si ya tiene cuenta, en Supabase → SQL Editor inserte su perfil con court_id de su despacho (p. ej. court-1).'
      );
    }
    profileCourtId = String(row.court_id).trim();
    if (row.is_superuser === true) return;
  }

  if (profileCourtId !== courtId) {
    throw new Error(
      `El despacho de su perfil (${profileCourtId}) no coincide con el de la aplicación (${courtId}). ` +
        'Actualice court_id en public.profiles o reinicie sesión.'
    );
  }
}
