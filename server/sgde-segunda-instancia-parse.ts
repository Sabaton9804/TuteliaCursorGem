/**
 * Extracción heurística de datos de correo de reparto / SGDE para segunda instancia.
 */

export type SegundaInstanciaEmailParse = {
  isSegundaInstancia: boolean;
  originRadicado: string | null;
  originCourt: string | null;
  motivo: string | null;
  sentenciaFecha: string | null;
  repartoSecuencia: string | null;
  /** Nodo Alfresco si el correo trae enlace SGDE (compartidos / usuario-interno). */
  sgdeNodeId: string | null;
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

const CUI_REGEX = /\b(\d{23})\b/g;

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

  const cuesSegunda = [
    /\bAPELACI[ÓO]N\b/i,
    /\bsegunda\s+instancia\b/i,
    /\befecto\s+SUSPENSIVO\b/i,
    /\brecurso\s+de\s+apelaci[oó]n\b/i,
    /\bsentencia\s+de\s+fecha\b/i,
    /\bremite.*competente\b/i,
    /\bACTA\s+DE\s+REPARTO\b/i,
  ];
  const isSegundaInstancia = cuesSegunda.some((re) => re.test(combined));

  let originRadicado: string | null = null;
  const expMatch = combined.match(/Expediente:\s*(\d{23})/i);
  if (expMatch) originRadicado = expMatch[1];
  if (!originRadicado) {
    const subjMatch = subject.match(/\b(\d{23})\b/);
    if (subjMatch) originRadicado = subjMatch[1];
  }
  if (!originRadicado) {
    const all = [...combined.matchAll(CUI_REGEX)].map((m) => m[1]);
    if (all.length) originRadicado = all[0];
  }

  let originCourt: string | null = null;
  const courtMatch = combined.match(/Despacho\s+custodio:\s*([^\n\r]+)/i);
  if (courtMatch) originCourt = courtMatch[1].trim();

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

  const sgdeNodeId = extractSgdeNodeIdFromText(combined);

  return {
    isSegundaInstancia,
    originRadicado,
    originCourt,
    motivo,
    sentenciaFecha,
    repartoSecuencia,
    sgdeNodeId,
  };
}
