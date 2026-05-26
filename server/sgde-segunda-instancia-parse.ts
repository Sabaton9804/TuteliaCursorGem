/**
 * Extracción heurística de datos de correo de reparto / SGDE para segunda instancia.
 */

import {
  extractPlainTextFromPdfBuffer,
  filenameSuggestsActaReparto,
} from '../pdf-acta-detect';
import {
  extractExplicitCuiFromText,
  resolveOriginRadicadoFromRepartoEmail,
} from '../src/lib/reparto-origin-cui.ts';
import { extractSegundaFieldsFromText } from '../src/lib/segunda-instancia-extract.ts';
import type { CaseAppellant, CaseOriginRuling } from '../src/types.ts';

export type SegundaInstanciaEmailParse = {
  isSegundaInstancia: boolean;
  originRadicado: string | null;
  originCourt: string | null;
  motivo: string | null;
  sentenciaFecha: string | null;
  repartoSecuencia: string | null;
  /** Nodo Alfresco si el correo trae enlace SGDE (compartidos / usuario-interno). */
  sgdeNodeId: string | null;
  appellant: CaseAppellant | null;
  originRuling: CaseOriginRuling | null;
};

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function extractSgdeNodeIdFromText(text: string): string | null {
  const decoded = text.replace(/&amp;/g, '&').replace(/%2F/gi, '/');
  const patterns = [
    /\/nodes\/([0-9a-f-]{36})/i,
    /nodeId[=:]([0-9a-f-]{36})/i,
    /nodeRef[=:]([^&\s"']+)/i,
    /\/expedientes\/usuario-interno\/[^?]*[?&](?:id|nodeId)=([0-9a-f-]{36})/i,
    /\/ficheror\/([0-9a-f-]{36})/i,
  ];
  for (const re of patterns) {
    const m = decoded.match(re);
    if (m?.[1] && UUID_RE.test(m[1])) return m[1].toLowerCase();
  }
  const all = [...decoded.matchAll(UUID_RE)];
  if (all.length === 1) return all[0][0].toLowerCase();
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSegundaInstanciaFromEmail(
  subject: string,
  bodyText: string,
  bodyHtml?: string
): SegundaInstanciaEmailParse {
  const htmlPlain = bodyHtml ? stripHtml(bodyHtml) : '';
  const combined = `${subject}\n${bodyText || ''}\n${htmlPlain}`;

  // Incluye “apelación” solo como señal de detección (juzgados la usan mal); la UI dice impugnación.
  const cuesSegunda = [
    /\bAPELACI[ÓO]N\b/i,
    /\brecurso\s+de\s+apelaci[oó]n\b/i,
    /\bsegunda\s+instancia\b/i,
    /\befecto\s+SUSPENSIVO\b/i,
    /\bsentencia\s+de\s+fecha\b/i,
    /\bremite.*competente\b/i,
    /\bACTA\s+DE\s+REPARTO\b/i,
    /\bREMISI[ÓO]N\s+(?:EXPEDIENTE|DEL\s+EXPEDIENTE)\b/i,
    /\bACCION\s+DE\s+TUTELA\b/i,
    /\bIMPUGNACI[ÓO]N\b/i,
    /\bAutoConcedeImpugnacion\b/i,
    /\bSolicitud\s+de\s+traslado\b/i,
    /\btraslado\s+del\s+proceso\s+judicial\b/i,
    /\baceptaci[oó]n\s+o\s+rechazo\b/i,
    /\bREPARTO\s+SECUENCIA\b/i,
    /\bSECUENCIA\s+\d+\s+RV:/i,
  ];
  const isSegundaInstancia =
    cuesSegunda.some((re) => re.test(combined)) ||
    (/\bREMISI[ÓO]N\b/i.test(combined) && /\bTUTELA\b/i.test(combined));

  const repartoResolved = resolveOriginRadicadoFromRepartoEmail(subject, `${bodyText || ''}\n${htmlPlain}`);
  let originRadicado: string | null = repartoResolved.originRadicado;
  let originCourt: string | null = repartoResolved.originCourt;

  if (!originRadicado) {
    const expMatch = combined.match(/Expediente:\s*(\d{23})/i);
    if (expMatch) originRadicado = expMatch[1];
  }
  if (!originRadicado) {
    originRadicado = extractExplicitCuiFromText(combined);
  }
  if (!originCourt) {
    const courtMatch = combined.match(/Despacho\s+custodio:\s*([^\n\r]+)/i);
    if (courtMatch) originCourt = courtMatch[1].trim();
  }

  let motivo: string | null = null;
  const motivoMatch = combined.match(/Motivo:\s*([^\n\r]+(?:\n[^\n\r_]+)?)/i);
  if (motivoMatch) motivo = motivoMatch[1].replace(/\s+/g, ' ').trim().slice(0, 500);

  let sentenciaFecha: string | null = null;
  const fechaMatch = combined.match(
    /sentencia\s+de\s+fecha\s+(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i
  );
  if (fechaMatch) sentenciaFecha = fechaMatch[1].trim();

  let repartoSecuencia: string | null = null;
  const seqMatch = combined.match(/REPARTO\s+SECUENCIA:\s*(\d+)/i);
  if (seqMatch) repartoSecuencia = seqMatch[1];
  if (!repartoSecuencia) {
    const subjSeq = subject.match(/\bSECUENCIA\s+(\d{1,6})\b/i);
    if (subjSeq) repartoSecuencia = subjSeq[1];
  }

  const sgdeNodeId = extractSgdeNodeIdFromText(combined);
  const fields = extractSegundaFieldsFromText(combined, 'Cuerpo del correo');

  return {
    isSegundaInstancia,
    originRadicado,
    originCourt,
    motivo,
    sentenciaFecha,
    repartoSecuencia,
    sgdeNodeId,
    appellant: fields.appellant,
    originRuling: fields.originRuling,
  };
}

function pdfAttachmentPriority(filename: string): number {
  const lower = filename.toLowerCase();
  if (lower.includes('actareparto') || filenameSuggestsActaReparto(lower)) return 1;
  if (lower.includes('impugnacion')) return 2;
  if (lower.includes('auto')) return 3;
  return 9;
}

/** Lee adjuntos PDF del correo (acta de reparto primero) para obtener Expediente / CUI de 23 dígitos. */
export async function digestPdfAttachmentsForSegundaInstancia(
  attachments: { buffer: Buffer; filename: string; contentType?: string }[]
): Promise<string> {
  const pdfs = attachments
    .filter((a) => {
      const ct = (a.contentType || '').toLowerCase();
      const fn = a.filename.toLowerCase();
      return ct.includes('pdf') || fn.endsWith('.pdf');
    })
    .sort((a, b) => pdfAttachmentPriority(a.filename) - pdfAttachmentPriority(b.filename));

  let digest = '';
  for (const att of pdfs) {
    const plain = await extractPlainTextFromPdfBuffer(att.buffer, 3);
    if (plain.trim()) {
      digest += `\n${plain}\n`;
      const cui = extractExplicitCuiFromText(plain);
      if (cui) {
        digest += `\nExpediente: ${cui}\n`;
        return digest;
      }
    }
  }
  return digest;
}
