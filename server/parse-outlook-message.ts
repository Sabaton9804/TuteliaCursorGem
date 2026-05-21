import { getMessageMime } from './outlook-graph';
import { supplementParseSessionFromGraphAttachments } from './outlook-graph-attachments';
import { parseJudicialEmailFromBuffer, type ParsedJudicialEmailResponse } from './parse-judicial-email';
import {
  getParseSession,
  replaceParseSessionAttachments,
  type ParseSessionRow,
} from './parse-email-sessions';

export type OutlookMessageSession = {
  parsed: ParsedJudicialEmailResponse;
  attachments: ParseSessionRow[];
};

/** Descarga MIME de Outlook, parsea y devuelve sesión en RAM (mismo flujo que POST .../parse). */
export async function parseOutlookMessageToSession(
  messageId: string,
  accessToken: string
): Promise<OutlookMessageSession> {
  const mime = await getMessageMime(accessToken, messageId);
  const parsed = await parseJudicialEmailFromBuffer(mime);
  const session = getParseSession(parsed.parseSessionId);
  if (!session) {
    throw new Error('No se pudo crear la sesión temporal de adjuntos.');
  }

  let attachments = session.attachments;
  const merged = await supplementParseSessionFromGraphAttachments(accessToken, messageId, attachments);
  if (merged.length !== attachments.length) {
    replaceParseSessionAttachments(parsed.parseSessionId, merged);
    attachments = merged;
  }

  return { parsed, attachments };
}
