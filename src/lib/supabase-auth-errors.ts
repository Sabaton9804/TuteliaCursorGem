/** Errores típicos de GoTrue / Supabase Auth (texto en inglés en la API). */
export function isLocalSupabaseAnonymousDisabled(err: unknown): boolean {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : '';
  const lower = msg.toLowerCase();
  return (
    lower.includes('anonymous') ||
    lower.includes('anon') && lower.includes('disabled') ||
    lower.includes('signups not allowed')
  );
}

export function getSupabaseAuthErrorMessage(err: unknown): string {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : '';
  const lower = msg.toLowerCase();
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Error de red al contactar Supabase. Revise conexión, VPN y bloqueadores.';
  }
  if (isLocalSupabaseAnonymousDisabled(err)) {
    return 'El acceso anónimo está deshabilitado en Supabase (Authentication → Providers → Anonymous). Use «Ingresar con Google» o habilítelo.';
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials') || lower.includes('email not confirmed')) {
    return 'Correo o contraseña incorrectos, o el correo no está confirmado. Con admin / admin ejecute «npm run seed:dev-admin» (una vez) y active Email en Auth de Supabase.';
  }
  if (msg) return `Error de autenticación: ${msg}`;
  return 'No se pudo autenticar con Supabase.';
}
