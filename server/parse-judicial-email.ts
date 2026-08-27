import { simpleParser } from 'mailparser';
import JSZip from 'jszip';
import axios from 'axios';
import {
  assertSafeJudicialArchiveUrl,
  JUDICIAL_ARCHIVE_MAX_REDIRECTS,
  UnsafeJudicialArchiveUrlError,
  unwrapJudicialArchiveUrl,
} from './safe-judicial-archive-url';
import {
  ACTA_REPARTO_DISPLAY_NAME,
  detectActaRepartoInPdfBuffer,
  filenameSuggestsActaReparto,
} from '../pdf-acta-detect';
import { createParseSession, type ParseSessionRow } from './parse-email-sessions';

/** Prioridad de adjuntos judiciales (1 = ActaReparto, 2 = EscritoDemanda, …). */
export function judicialAttachmentPriority(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes('actareparto')) return 1;
  if (lower.includes('escritodemanda')) return 2;
  if (lower.includes('poder')) return 3;
  if (lower.includes('documentospruebasanexos')) return 4;
  return 5;
}

export { unwrapJudicialArchiveUrl };

type ProcAtt = {
  filename: string;
  originalName?: string;
  size?: number;
  contentType?: string;
  content?: string;
  /** Preferir buffer para PDFs grandes (Demanda en línea ~50–100 MB). */
  buffer?: Buffer;
  isFromLink?: boolean;
  tempOrder?: number;
  order?: number;
};

const ARCHIVE_LINK_TIMEOUT_MS = 120_000;
const ARCHIVE_LINK_MAX_BYTES = 120 * 1024 * 1024;

async function attachmentsFromZipBuffer(
  fileBuffer: Buffer,
  opts: { isFromLink: boolean; nextOrder: () => number }
): Promise<ProcAtt[]> {
  const zip = new JSZip();
  await zip.loadAsync(fileBuffer);
  const filePromises: Promise<ProcAtt>[] = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    filePromises.push(
      (async () => {
        const filename = relativePath;
        const lowerName = filename.toLowerCase();
        let innerContentType = 'application/octet-stream';
        if (lowerName.endsWith('.pdf')) innerContentType = 'application/pdf';
        else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) innerContentType = 'image/jpeg';
        else if (lowerName.endsWith('.png')) innerContentType = 'image/png';

        let baseName = filename;
        if (lowerName.includes('demanda')) baseName = 'EscritoDemanda';
        else if (lowerName.includes('prueba') || lowerName.includes('anexo')) baseName = 'DocumentosPruebasAnexos';
        else if (lowerName.includes('poder')) baseName = 'Poder';
        else if (filenameSuggestsActaReparto(lowerName)) baseName = 'ActaReparto';

        let originalNameOut = filename;
        let contentB64: string;
        if (innerContentType === 'application/pdf') {
          const pdfBuf = Buffer.from(await file.async('nodebuffer'));
          if (baseName === filename && (await detectActaRepartoInPdfBuffer(pdfBuf))) {
            baseName = 'ActaReparto';
            originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
          }
          contentB64 = pdfBuf.toString('base64');
        } else {
          contentB64 = await file.async('base64');
        }

        return {
          filename: baseName,
          originalName: baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : originalNameOut,
          size: (file as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0,
          contentType: innerContentType,
          content: contentB64,
          isFromLink: opts.isFromLink,
          tempOrder: opts.nextOrder(),
        };
      })()
    );
  });
  return Promise.all(filePromises);
}

async function downloadArchiveBufferFollowingRedirects(
  startUrl: string,
): Promise<{ fileBuffer: Buffer; contentType: string; finalUrl: string } | null> {
  let current = startUrl;
  for (let hop = 0; hop <= JUDICIAL_ARCHIVE_MAX_REDIRECTS; hop++) {
    const safe = await assertSafeJudicialArchiveUrl(current);
    let response;
    try {
      response = await axios.get(safe.toString(), {
        responseType: 'arraybuffer',
        timeout: ARCHIVE_LINK_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: ARCHIVE_LINK_MAX_BYTES,
        maxBodyLength: ARCHIVE_LINK_MAX_BYTES,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/pdf,application/zip,*/*;q=0.8',
        },
        validateStatus: (status) => status < 500,
      });
    } catch (err) {
      const ax = err as { response?: { status?: number; headers?: Record<string, unknown>; data?: unknown } };
      if (ax.response && typeof ax.response.status === 'number' && ax.response.status >= 300 && ax.response.status < 400) {
        response = ax.response as typeof response;
      } else {
        throw err;
      }
    }
    if (response.status >= 300 && response.status < 400) {
      const loc = String(response.headers.location || '').trim();
      if (!loc) throw new UnsafeJudicialArchiveUrlError('Redirección del portal sin encabezado Location.');
      current = new URL(loc, safe).toString();
      continue;
    }
    if (response.status >= 400) return null;
    const fileBuffer = Buffer.from(response.data);
    const contentType = String(response.headers['content-type'] || 'application/octet-stream')
      .split(';')[0]
      .trim();
    return { fileBuffer, contentType, finalUrl: safe.toString() };
  }
  throw new UnsafeJudicialArchiveUrlError('Demasiadas redirecciones al descargar el archivo judicial.');
}

async function downloadArchiveLinkAttachments(
  downloadUrl: string,
  nextOrder: () => number
): Promise<ProcAtt[]> {
  const downloaded = await downloadArchiveBufferFollowingRedirects(downloadUrl);
  if (!downloaded) return [];

  const { fileBuffer, finalUrl } = downloaded;
  let { contentType } = downloaded;
  const downloadUrlForName = finalUrl;

  const isPdfMagic =
    fileBuffer.length >= 5 &&
    fileBuffer[0] === 0x25 &&
    fileBuffer[1] === 0x50 &&
    fileBuffer[2] === 0x44 &&
    fileBuffer[3] === 0x46 &&
    fileBuffer[4] === 0x2d;

  const isZip =
    contentType === 'application/zip' ||
    downloadUrlForName.toLowerCase().split('?')[0].endsWith('.zip') ||
    (fileBuffer.length > 4 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b);

  if (isZip) {
    return attachmentsFromZipBuffer(fileBuffer, { isFromLink: true, nextOrder });
  }

  let baseName = 'DocumentosPruebasAnexos';
  const lowerUrl = downloadUrlForName.toLowerCase();
  if (filenameSuggestsActaReparto(lowerUrl)) baseName = 'ActaReparto';
  else if (lowerUrl.includes('demanda')) baseName = 'EscritoDemanda';

  if (!isPdfMagic) {
    const probe = fileBuffer
      .subarray(0, Math.min(800, fileBuffer.length))
      .toString('utf8')
      .trimStart()
      .toLowerCase();
    if (probe.startsWith('<!doctype') || probe.startsWith('<html') || probe.startsWith('<?xml')) {
      // Portal devolvió HTML (sesión/expirado) — no es el expediente.
      return [];
    } else if (contentType === 'application/pdf' || contentType === 'application/octet-stream') {
      contentType = 'application/octet-stream';
    }
  } else {
    contentType = 'application/pdf';
  }

  let originalLinkName = baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : 'archivo_descargado';
  // No escanear PDF enormes del portal (p. ej. 50+ MB): detectActa es costoso y suele ser la demanda completa.
  if (
    isPdfMagic &&
    baseName !== 'ActaReparto' &&
    fileBuffer.length < 8 * 1024 * 1024 &&
    (await detectActaRepartoInPdfBuffer(fileBuffer))
  ) {
    baseName = 'ActaReparto';
    originalLinkName = ACTA_REPARTO_DISPLAY_NAME;
  }

  return [
    {
      filename: baseName,
      originalName: originalLinkName,
      size: fileBuffer.length,
      contentType,
      buffer: fileBuffer,
      isFromLink: true,
      tempOrder: nextOrder(),
    },
  ];
}

/** Descarga el archivo del portal (Demanda en línea etc.) y lo deja listo para sesión de parseo. */
export async function fetchJudicialArchiveFromUrl(downloadUrl: string): Promise<ParseSessionRow[]> {
  const url = unwrapJudicialArchiveUrl(downloadUrl);
  if (!url) return [];
  let order = 0;
  const atts = await downloadArchiveLinkAttachments(url, () => order++);
  return atts.map((att, idx) => {
    const buf =
      att.buffer ||
      (att.content ? Buffer.from(String(att.content), 'base64') : Buffer.alloc(0));
    return {
      sessionIndex: idx,
      filename: String(att.filename),
      originalName: String(att.originalName || att.filename),
      contentType: String(att.contentType || 'application/octet-stream'),
      size: typeof att.size === 'number' ? att.size : buf.length,
      isFromLink: true,
      order: idx,
      buffer: buf,
    };
  });
}

export type ParsedJudicialEmailResponse = {
  subject: string | undefined;
  from: string | undefined;
  to: string;
  date: Date | undefined;
  text: string | false | undefined;
  html: string | false | undefined;
  attachments: Omit<ParseSessionRow, 'buffer'>[];
  parseSessionId: string;
  linkFound: boolean;
  linkUrl: string | null;
  linkPending: boolean;
};

export async function parseJudicialEmailFromBuffer(
  buffer: Buffer,
  ownerUserId?: string,
): Promise<ParsedJudicialEmailResponse> {
  const parsed = await simpleParser(buffer);

  let processedAttachments: ProcAtt[] = [];
  let globalOrderIndex = 0;
  const nextOrder = () => globalOrderIndex++;
  const nameCounters: Record<string, number> = {};

  const getUniqueName = (baseName: string) => {
    let finalName = baseName;
    if (nameCounters[baseName]) {
      nameCounters[baseName]++;
      finalName = `${baseName} (${nameCounters[baseName]})`;
    } else {
      nameCounters[baseName] = 1;
    }
    return finalName;
  };

  const htmlBody = parsed.html || '';
  const textBody = parsed.text || '';

  let linkMatch = htmlBody.match(/<a\s+[^>]*?href=(["'])(.*?)\1[^>]*?>\s*(?:Descargar\s+)?Archivo\s*<\/a>/i);
  let rawDownloadUrl: string | null = linkMatch ? linkMatch[2] : null;

  if (!rawDownloadUrl) {
    const textMatch = textBody.match(/Archivo:\s*(https?:\/\/[^\s]+)/i);
    if (textMatch) rawDownloadUrl = textMatch[1];
  }
  const downloadUrl = unwrapJudicialArchiveUrl(rawDownloadUrl);
  const linkFound = Boolean(downloadUrl);

  // 1) Primero MIME del .eml (acta SEC…, DEM…): no depender del enlace SafeLinks.
  const validAttachments = (parsed.attachments || []).filter((att) => !att.contentType?.startsWith('image/'));

  for (const att of validAttachments) {
    const lowerOrig = (att.filename || '').toLowerCase();
    let contentType = att.contentType || 'application/octet-stream';
    if (lowerOrig.endsWith('.pdf')) contentType = 'application/pdf';

    if (contentType === 'application/zip' || att.filename?.endsWith('.zip')) {
      const zipAtts = await attachmentsFromZipBuffer(
        Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content || []),
        { isFromLink: false, nextOrder }
      );
      processedAttachments = [...processedAttachments, ...zipAtts];
    } else {
      let baseName = att.filename || 'Documento';
      let originalNameOut = att.filename || 'Documento';
      if (filenameSuggestsActaReparto(lowerOrig)) baseName = 'ActaReparto';
      else if (lowerOrig.includes('poder')) baseName = 'Poder';
      else if (lowerOrig.includes('demanda')) baseName = 'EscritoDemanda';
      else if (lowerOrig.includes('prueba') || lowerOrig.includes('anexo')) baseName = 'DocumentosPruebasAnexos';

      if (contentType === 'application/pdf' && att.content && baseName === (att.filename || 'Documento')) {
        const pdfBuf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
        if (await detectActaRepartoInPdfBuffer(pdfBuf)) {
          baseName = 'ActaReparto';
          originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
        }
      }
      if (baseName === 'ActaReparto') originalNameOut = ACTA_REPARTO_DISPLAY_NAME;

      processedAttachments.push({
        filename: baseName,
        originalName: originalNameOut,
        size: att.size,
        contentType,
        content: att.content ? att.content.toString('base64') : '',
        tempOrder: nextOrder(),
      });
    }
  }

  // El enlace «Archivo» (PDF/ZIP Demanda en línea, a menudo 30–60+ MB y ~30 s) se descarga
  // en POST /api/parse-session/:id/fetch-archive para no dejar «Procesando…» eterno.

  processedAttachments.sort((a, b) => {
    const pA = judicialAttachmentPriority(String(a.filename || ''));
    const pB = judicialAttachmentPriority(String(b.filename || ''));
    if (pA !== pB) return pA - pB;
    return Number(a.tempOrder || 0) - Number(b.tempOrder || 0);
  });

  const finalProcessed = processedAttachments.map((att, idx) => {
    const uniqueName = getUniqueName(String(att.filename || 'Documento'));
    return { ...att, filename: uniqueName, originalName: uniqueName, order: idx };
  });

  const sessionAttachments: ParseSessionRow[] = finalProcessed.map((att, idx) => {
    const buf =
      att.buffer ||
      (att.content ? Buffer.from(String(att.content), 'base64') : Buffer.alloc(0));
    return {
      sessionIndex: idx,
      filename: String(att.filename),
      originalName: String(att.originalName || att.filename),
      contentType: String(att.contentType || 'application/octet-stream'),
      size: typeof att.size === 'number' ? att.size : buf.length,
      isFromLink: Boolean(att.isFromLink),
      order: typeof att.order === 'number' ? att.order : idx,
      buffer: buf,
    };
  });

  const parseSessionId = createParseSession(sessionAttachments, ownerUserId?.trim() || 'script', {
    linkUrl: downloadUrl,
  });
  /** Límite por adjunto en JSON (el cliente usa esto para el visor sin depender solo de la sesión en RAM). */
  const MAX_INLINE_ATTACHMENT_BYTES = 14 * 1024 * 1024;
  const publicAttachments = sessionAttachments.map(({ buffer, ...meta }) => ({
    ...meta,
    ...(buffer.length > 0 && buffer.length <= MAX_INLINE_ATTACHMENT_BYTES
      ? { content: buffer.toString('base64') }
      : {}),
  }));

  return {
    subject: parsed.subject,
    from: parsed.from?.text,
    to: parsed.to
      ? Array.isArray(parsed.to)
        ? (parsed.to[0] as { text?: string })?.text
        : (parsed.to as { text?: string })?.text
      : '',
    date: parsed.date,
    text: parsed.text,
    html: parsed.html,
    attachments: publicAttachments,
    parseSessionId,
    linkFound,
    linkUrl: downloadUrl,
    /** El cliente debe llamar a fetch-archive si es true. */
    linkPending: Boolean(downloadUrl),
  };
}
