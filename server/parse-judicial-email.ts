import { simpleParser } from 'mailparser';
import JSZip from 'jszip';
import axios from 'axios';
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
};

export async function parseJudicialEmailFromBuffer(
  buffer: Buffer,
  ownerUserId?: string,
): Promise<ParsedJudicialEmailResponse> {
  const parsed = await simpleParser(buffer);

  type ProcAtt = {
    filename: string;
    originalName?: string;
    size?: number;
    contentType?: string;
    content?: string;
    isFromLink?: boolean;
    tempOrder?: number;
    order?: number;
  };
  let processedAttachments: ProcAtt[] = [];
  let globalOrderIndex = 0;
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

  const getPriority = judicialAttachmentPriority;

  const htmlBody = parsed.html || '';
  const textBody = parsed.text || '';

  let linkMatch = htmlBody.match(/<a\s+[^>]*?href=(["'])(.*?)\1[^>]*?>\s*(?:Descargar\s+)?Archivo\s*<\/a>/i);
  let downloadUrl: string | null = linkMatch ? linkMatch[2] : null;

  if (!downloadUrl) {
    const textMatch = textBody.match(/Archivo:\s*(https?:\/\/[^\s]+)/i);
    if (textMatch) downloadUrl = textMatch[1];
  }

  let linkFound = false;
  if (downloadUrl) {
    linkFound = true;
    try {
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxRedirects: 15,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/pdf,application/zip,*/*;q=0.8',
        },
        validateStatus: (status) => status < 500,
      });

      if (response.status < 400) {
        const fileBuffer = Buffer.from(response.data);
        let contentType = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();

        const isPdfMagic =
          fileBuffer.length >= 5 &&
          fileBuffer[0] === 0x25 &&
          fileBuffer[1] === 0x50 &&
          fileBuffer[2] === 0x44 &&
          fileBuffer[3] === 0x46 &&
          fileBuffer[4] === 0x2d;

        const isZip =
          contentType === 'application/zip' ||
          downloadUrl.toLowerCase().split('?')[0].endsWith('.zip') ||
          (fileBuffer.length > 4 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b);

        if (isZip) {
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
                  isFromLink: true,
                  tempOrder: globalOrderIndex++,
                };
              })()
            );
          });
          processedAttachments = [...processedAttachments, ...(await Promise.all(filePromises))];
        } else {
          let baseName = 'DocumentosPruebasAnexos';
          const lowerUrl = downloadUrl.toLowerCase();
          if (filenameSuggestsActaReparto(lowerUrl)) baseName = 'ActaReparto';
          else if (lowerUrl.includes('demanda')) baseName = 'EscritoDemanda';

          if (!isZip && !isPdfMagic) {
            const probe = fileBuffer
              .subarray(0, Math.min(800, fileBuffer.length))
              .toString('utf8')
              .trimStart()
              .toLowerCase();
            if (probe.startsWith('<!doctype') || probe.startsWith('<html') || probe.startsWith('<?xml')) {
              contentType = 'text/html';
            } else if (contentType === 'application/pdf' || contentType === 'application/octet-stream') {
              contentType = 'application/octet-stream';
            }
          } else if (isPdfMagic) {
            contentType = 'application/pdf';
          }

          let originalLinkName = baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : 'archivo_descargado';
          if (isPdfMagic && baseName !== 'ActaReparto' && (await detectActaRepartoInPdfBuffer(fileBuffer))) {
            baseName = 'ActaReparto';
            originalLinkName = ACTA_REPARTO_DISPLAY_NAME;
          }

          processedAttachments.push({
            filename: baseName,
            originalName: originalLinkName,
            size: fileBuffer.length,
            contentType,
            content: fileBuffer.toString('base64'),
            isFromLink: true,
            tempOrder: globalOrderIndex++,
          });
        }
      }
    } catch (downloadError) {
      console.error('Error downloading file from Archivo link:', downloadError);
    }
  }

  const validAttachments = (parsed.attachments || []).filter((att) => !att.contentType?.startsWith('image/'));

  for (const att of validAttachments) {
    const lowerOrig = (att.filename || '').toLowerCase();
    let contentType = att.contentType || 'application/octet-stream';
    if (lowerOrig.endsWith('.pdf')) contentType = 'application/pdf';

    if (contentType === 'application/zip' || att.filename?.endsWith('.zip')) {
      const zip = new JSZip();
      await zip.loadAsync(att.content);
      const filePromises: Promise<ProcAtt>[] = [];
      zip.forEach((relativePath, file) => {
        if (file.dir) return;
        filePromises.push(
          (async () => {
            const filename = relativePath;
            const lowerName = filename.toLowerCase();
            let innerContentType = 'application/octet-stream';
            if (lowerName.endsWith('.pdf')) innerContentType = 'application/pdf';

            let baseName = filename;
            if (lowerName.includes('demanda')) baseName = 'EscritoDemanda';
            else if (lowerName.includes('prueba') || lowerName.includes('anexo')) baseName = 'DocumentosPruebasAnexos';
            else if (lowerName.includes('poder')) baseName = 'Poder';
            else if (filenameSuggestsActaReparto(lowerName)) baseName = 'ActaReparto';

            let originalNameZip = filename;
            let contentB64Zip: string;
            if (innerContentType === 'application/pdf') {
              const pdfBuf = Buffer.from(await file.async('nodebuffer'));
              if (baseName === filename && (await detectActaRepartoInPdfBuffer(pdfBuf))) {
                baseName = 'ActaReparto';
                originalNameZip = ACTA_REPARTO_DISPLAY_NAME;
              }
              contentB64Zip = pdfBuf.toString('base64');
            } else {
              contentB64Zip = await file.async('base64');
            }

            return {
              filename: baseName,
              originalName: baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : originalNameZip,
              size: (file as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0,
              contentType: innerContentType,
              content: contentB64Zip,
              tempOrder: globalOrderIndex++,
            };
          })()
        );
      });
      processedAttachments = [...processedAttachments, ...(await Promise.all(filePromises))];
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
        tempOrder: globalOrderIndex++,
      });
    }
  }

  processedAttachments.sort((a, b) => {
    const pA = getPriority(String(a.filename || ''));
    const pB = getPriority(String(b.filename || ''));
    if (pA !== pB) return pA - pB;
    return Number(a.tempOrder || 0) - Number(b.tempOrder || 0);
  });

  const finalProcessed = processedAttachments.map((att, idx) => {
    const uniqueName = getUniqueName(String(att.filename || 'Documento'));
    return { ...att, filename: uniqueName, originalName: uniqueName, order: idx };
  });

  const sessionAttachments: ParseSessionRow[] = finalProcessed.map((att, idx) => {
    const buf = Buffer.from(String(att.content || ''), 'base64');
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

  const parseSessionId = createParseSession(sessionAttachments, ownerUserId);
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
  };
}
