/** Cuenta de plataforma (todos los despachos vía is_superuser en profiles). */
export const SUPERUSER_EMAIL = 'sabaton98@tutelia.local';

export const SUPERUSER_LOGIN_ALIASES = ['sabaton98', 'Sabaton98'] as const;

export function isSuperuserLoginAlias(login: string): boolean {
  const t = login.trim();
  return SUPERUSER_LOGIN_ALIASES.some((a) => a.toLowerCase() === t.toLowerCase());
}

export function resolveSuperuserEmail(login: string): string {
  if (isSuperuserLoginAlias(login)) return SUPERUSER_EMAIL;
  return login.trim();
}
