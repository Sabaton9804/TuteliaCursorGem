/**
 * Identificador fijo del usuario de desarrollo; la cuenta vive en Supabase Auth, no en .env.
 */
export const DEV_ADMIN_EMAIL = 'admin@tutelia.local';

/** Supabase exige ≥6 caracteres; el formulario puede seguir usando «admin». */
export const DEV_ADMIN_PASSWORD = 'admin0';

export function getDevAdminEmail(): string {
  return DEV_ADMIN_EMAIL;
}

/** Contraseña enviada a Auth si el usuario escribe el atajo de desarrollo «admin». */
export function resolveDevAdminPassword(typedPassword: string): string {
  return typedPassword === 'admin' ? DEV_ADMIN_PASSWORD : typedPassword;
}
