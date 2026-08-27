import { randomUUID } from 'node:crypto';

export type ParseSessionRow = {
  sessionIndex: number;
  filename: string;
  originalName?: string;
  contentType: string;
  size: number;
  isFromLink?: boolean;
  order?: number;
  buffer: Buffer;
};

export type ParseSession = {
  createdAt: number;
  ownerUserId?: string;
  attachments: ParseSessionRow[];
  /** URL «Archivo» / Demanda en línea pendiente o usada para enriquecer la sesión. */
  linkUrl?: string;
  linkFetchedAt?: number;
  linkFetchError?: string;
};

const parseSessions = new Map<string, ParseSession>();
export const PARSE_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export function sweepParseSessions() {
  const now = Date.now();
  for (const [id, s] of parseSessions) {
    if (now - s.createdAt > PARSE_SESSION_TTL_MS) parseSessions.delete(id);
  }
}

export function getParseSession(sessionId: string): ParseSession | undefined {
  sweepParseSessions();
  return parseSessions.get(sessionId);
}

/** Extiende la sesión mientras el usuario revisa adjuntos en radicación. */
export function touchParseSession(sessionId: string): void {
  const session = parseSessions.get(sessionId);
  if (!session) return;
  parseSessions.set(sessionId, { ...session, createdAt: Date.now() });
}

export function createParseSession(
  attachments: ParseSessionRow[],
  ownerUserId: string,
  opts?: { linkUrl?: string | null }
): string {
  sweepParseSessions();
  const owner = ownerUserId.trim();
  if (!owner) {
    throw new Error('ownerUserId es obligatorio para la sesión de parseo.');
  }
  const parseSessionId = randomUUID();
  parseSessions.set(parseSessionId, {
    createdAt: Date.now(),
    ownerUserId: owner,
    attachments,
    linkUrl: opts?.linkUrl?.trim() || undefined,
  });
  return parseSessionId;
}

/** La sesión debe tener dueño y coincidir con el caller. Sesiones sin owner se niegan. */
export function parseSessionOwnedBy(session: ParseSession, userId: string): boolean {
  const owner = String(session.ownerUserId || '').trim();
  return Boolean(owner) && owner === userId;
}

export function replaceParseSessionAttachments(sessionId: string, attachments: ParseSessionRow[]): boolean {
  sweepParseSessions();
  const session = parseSessions.get(sessionId);
  if (!session) return false;
  parseSessions.set(sessionId, { ...session, attachments, createdAt: Date.now() });
  return true;
}

/** Añade adjuntos (p. ej. PDF/ZIP del portal Demanda en línea) y reindexa sessionIndex. */
export function appendParseSessionAttachments(
  sessionId: string,
  newRows: Omit<ParseSessionRow, 'sessionIndex' | 'order'>[]
): ParseSessionRow[] | null {
  sweepParseSessions();
  const session = parseSessions.get(sessionId);
  if (!session) return null;
  const start = session.attachments.length;
  const appended: ParseSessionRow[] = newRows.map((row, i) => ({
    ...row,
    sessionIndex: start + i,
    order: start + i,
  }));
  const attachments = [...session.attachments, ...appended].map((a, idx) => ({
    ...a,
    sessionIndex: idx,
    order: idx,
  }));
  parseSessions.set(sessionId, {
    ...session,
    attachments,
    createdAt: Date.now(),
    linkFetchedAt: Date.now(),
    linkFetchError: undefined,
  });
  return attachments;
}

export function markParseSessionLinkError(sessionId: string, message: string): void {
  const session = parseSessions.get(sessionId);
  if (!session) return;
  parseSessions.set(sessionId, {
    ...session,
    linkFetchError: message,
    linkFetchedAt: Date.now(),
    createdAt: Date.now(),
  });
}
