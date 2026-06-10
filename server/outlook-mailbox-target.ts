export type MailboxGraphTarget =
  | { mode: 'me' }
  | { mode: 'shared'; upn: string };

/** Valida y normaliza UPN para Graph /users/{upn}. */
export function normalizeMailboxUpn(raw: string): string {
  const upn = raw.trim().toLowerCase();
  if (!upn || /\s/.test(upn) || !upn.includes('@')) {
    throw new Error('UPN de buzón inválido.');
  }
  return upn;
}

/**
 * Ruta relativa bajo el recurso de buzón en Graph v1.0.
 * @param relativePath - debe empezar con / (ej. /mailFolders/inbox/messages)
 */
export function graphMailboxPath(target: MailboxGraphTarget, relativePath: string): string {
  const rel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  if (target.mode === 'me') return `/me${rel}`;
  const upn = encodeURIComponent(normalizeMailboxUpn(target.upn));
  return `/users/${upn}${rel}`;
}

export function graphMailboxAbsoluteUrl(target: MailboxGraphTarget, relativePath: string): string {
  return `https://graph.microsoft.com/v1.0${graphMailboxPath(target, relativePath)}`;
}
