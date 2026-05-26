/** Dominio de correos creados por `npm run seed:court-users`. */
export const COURT_SEED_EMAIL_DOMAIN = 'tutelia-despacho.seed';

/**
 * Convierte el usuario del formulario (p. ej. `Paola.Martinez`) al email de Auth.
 * Si ya trae `@`, se usa tal cual (normalizado a minúsculas).
 */
export function resolveCourtSeedLoginEmail(login: string): string {
  const t = login.trim();
  if (!t) return t;
  if (t.includes('@')) return t.toLowerCase();
  return `${t.toLowerCase()}@${COURT_SEED_EMAIL_DOMAIN}`;
}
