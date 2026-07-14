import type { CaseType } from '../types';
import { mapTipoProcesoToCivilCaseType } from './case-process-scope';

export type EmailInferCorpus = {
  subject?: string | null;
  from?: string | null;
  to?: string | null;
  text?: string | null;
  html?: string | null;
};

/**
 * Inferencia de tipo de radicación desde metadatos del correo
 * (remitente Cendoj, Demanda en línea, tutela, etc.) antes de la IA.
 */
export function inferCaseTypeFromParsedEmail(email: EmailInferCorpus): CaseType | null {
  const subject = String(email.subject || '');
  const from = String(email.from || '');
  const to = String(email.to || '');
  const text = String(email.text || '');
  const html = String(email.html || '');
  const corpus = `${subject}\n${from}\n${to}\n${text}\n${html}`.toLowerCase();
  if (!corpus.trim()) return null;

  if (/consulta\s+(de\s+)?(incidente\s+de\s+)?desacato/.test(corpus)) {
    return 'consulta_desacato';
  }
  if (
    /impugnaci[oó]n/.test(corpus) &&
    (/segunda\s+instancia|juzgado\s+.*remit|fallo\s+de\s+primera/.test(corpus) || /tutela/.test(corpus))
  ) {
    return 'tutela_segunda';
  }

  const civilMail =
    /raddemcivil|demandas?\s+juzgados?\s+civiles|demanda\s+en\s+l[ií]nea|demandaenlinea|procesojudicial\.ramajudicial\.gov\.co\/demandaenlinea|oficina\s+de\s+reparto/.test(
      corpus,
    ) && !/\btutela\b|derecho\s+fundamental|acci[oó]n\s+de\s+tutela/.test(corpus);

  if (civilMail || (/asignaci[oó]n\s+reparto\s+secuencia/.test(corpus) && !/\btutela\b/.test(corpus))) {
    return mapTipoProcesoToCivilCaseType(corpus);
  }

  if (/\btutela\b|derecho\s+fundamental|acci[oó]n\s+de\s+tutela/.test(corpus)) {
    return 'tutela_primera';
  }

  return null;
}
