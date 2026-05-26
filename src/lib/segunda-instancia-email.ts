import type { SegundaInstanciaEmailParse } from './sgde-api';
import { parseSegundaInstanciaClient } from './sgde-api';

export function extractSgdeNodeIdFromText(text: string): string | null {
  const decoded = text.replace(/&amp;/g, '&').replace(/%2F/gi, '/');
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const patterns = [
    /\/nodes\/([0-9a-f-]{36})/i,
    /nodeId[=:]([0-9a-f-]{36})/i,
    /\/ficheror\/([0-9a-f-]{36})/i,
  ];
  for (const re of patterns) {
    const m = decoded.match(re);
    if (m?.[1] && uuidRe.test(m[1])) return m[1].toLowerCase();
  }
  const all = [...decoded.matchAll(uuidRe)];
  if (all.length === 1) return all[0][0].toLowerCase();
  return null;
}

export type { SegundaInstanciaEmailParse };

export function extractSegundaInstanciaFromParsedEmail(parsed: {
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  segundaInstancia?: unknown;
}): SegundaInstanciaEmailParse {
  const subject = String(parsed.subject || '');
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const embedded = parsed.segundaInstancia as SegundaInstanciaEmailParse | undefined;
  if (embedded && (embedded.isSegundaInstancia || embedded.originRadicado)) {
    return {
      ...embedded,
      sgdeNodeId: embedded.sgdeNodeId ?? extractSgdeNodeIdFromText(`${subject}\n${text}\n${html}`),
    };
  }
  return parseSegundaInstanciaClient(subject, text, html);
}

export function shouldUseSegundaInstanciaFlow(si: SegundaInstanciaEmailParse): boolean {
  return Boolean(si.isSegundaInstancia && si.originRadicado);
}

/** Correo de reparto / remisión / traslado con CUI listo para consultar SGDE. */
export function shouldTriggerSgdeAfterEmailParse(si: SegundaInstanciaEmailParse): boolean {
  return Boolean(si.originRadicado?.replace(/\D/g, '').length === 23);
}
