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
  attachments: ParseSessionRow[];
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

export function createParseSession(attachments: ParseSessionRow[]): string {
  sweepParseSessions();
  const parseSessionId = randomUUID();
  parseSessions.set(parseSessionId, {
    createdAt: Date.now(),
    attachments,
  });
  return parseSessionId;
}

export function replaceParseSessionAttachments(sessionId: string, attachments: ParseSessionRow[]): boolean {
  sweepParseSessions();
  const session = parseSessions.get(sessionId);
  if (!session) return false;
  parseSessions.set(sessionId, { ...session, attachments });
  return true;
}
