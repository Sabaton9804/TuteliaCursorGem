import type { SupabaseClient } from '@supabase/supabase-js';

export async function getProfileCourtId(
  admin: SupabaseClient,
  userId: string
): Promise<{ ok: true; courtId: string } | { ok: false; status: number; message: string }> {
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('court_id')
    .eq('id', userId)
    .maybeSingle();
  if (profErr || !prof?.court_id) {
    return { ok: false, status: 403, message: 'Perfil sin despacho asignado.' };
  }
  return { ok: true, courtId: String(prof.court_id) };
}
