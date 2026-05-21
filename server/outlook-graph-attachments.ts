import { simpleParser } from 'mailparser';
import { graphFetch, graphRequest } from './outlook-graph';
import type { ParseSessionRow } from './parse-email-sessions';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export type OutlookAttachmentKind = 'file' | 'reference' | 'item' | 'other';

export type OutlookAttachmentMeta = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  kind: OutlookAttachmentKind;
  isInline: boolean;
  /** Si el adjunto está en un correo reenviado embebido */
  sourceMessageId?: string;
};

type GraphAttachmentRow = {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  '@odata.type'?: string;
  contentBytes?: string;
  item?: {
    id?: string;
    attachments?: GraphAttachmentRow[];
  };
};

function outlookMessagePathId(messageId: string): string {
  const trimmed = messageId.trim();
  try {
    if (trimmed.includes('%')) {
      const decoded = decodeURIComponent(trimmed);
      if (decoded !== trimmed) return encodeURIComponent(decoded);
    }
  } catch {
    /* usar trimmed tal cual */
  }
  return encodeURIComponent(trimmed);
}

function attachmentKind(odataType: string | undefined): OutlookAttachmentKind {
  const t = String(odataType || '');
  if (t.includes('fileAttachment')) return 'file';
  if (t.includes('referenceAttachment')) return 'reference';
  if (t.includes('itemAttachment')) return 'item';
  return 'other';
}

function mapRow(
  row: GraphAttachmentRow,
  opts?: { displayName?: string; sourceMessageId?: string }
): OutlookAttachmentMeta | null {
  if (!row.id) return null;
  return {
    id: String(row.id),
    name: opts?.displayName || String(row.name || 'adjunto'),
    contentType: String(row.contentType || 'application/octet-stream'),
    size: typeof row.size === 'number' ? row.size : 0,
    kind: attachmentKind(row['@odata.type']),
    isInline: Boolean(row.isInline),
    sourceMessageId: opts?.sourceMessageId,
  };
}

async function fetchAttachmentRows(accessToken: string, messageId: string): Promise<GraphAttachmentRow[]> {
  const data = await graphRequest<{ value?: GraphAttachmentRow[] }>(
    accessToken,
    `/me/messages/${outlookMessagePathId(messageId)}/attachments`
  );
  return data.value ?? [];
}

async function expandItemAttachmentRows(
  accessToken: string,
  parentMessageId: string,
  attachmentId: string
): Promise<{ rows: GraphAttachmentRow[]; innerMessageId?: string }> {
  try {
    const row = await graphRequest<GraphAttachmentRow>(
      accessToken,
      `/me/messages/${outlookMessagePathId(parentMessageId)}/attachments/${outlookMessagePathId(attachmentId)}?$expand=microsoft.graph.itemattachment/item($expand=attachments)`
    );
    const innerMessageId = row.item?.id ? String(row.item.id) : undefined;
    if (Array.isArray(row.item?.attachments) && row.item.attachments.length) {
      return { rows: row.item.attachments, innerMessageId };
    }
    if (innerMessageId) {
      return { rows: await fetchAttachmentRows(accessToken, innerMessageId), innerMessageId };
    }
  } catch (e) {
    console.warn('[outlook] expand itemAttachment:', (e as Error)?.message || e);
  }
  return { rows: [] };
}

async function downloadItemAttachmentMime(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<Buffer | null> {
  const url = `${GRAPH_BASE}/me/messages/${outlookMessagePathId(messageId)}/attachments/${outlookMessagePathId(attachmentId)}/$value`;
  const res = await graphFetch(accessToken, url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Correos RV: el sobre exterior suele tener un itemAttachment; los PDF están en el mensaje interno.
 */
export async function listMessageAttachmentsMeta(
  accessToken: string,
  messageId: string
): Promise<OutlookAttachmentMeta[]> {
  const top = await fetchAttachmentRows(accessToken, messageId);
  const result: OutlookAttachmentMeta[] = [];

  for (const row of top) {
    const kind = attachmentKind(row['@odata.type']);
    if (kind === 'item' && row.id) {
      const { rows: nested, innerMessageId } = await expandItemAttachmentRows(
        accessToken,
        messageId,
        row.id
      );
      if (nested.length) {
        const prefix = String(row.name || 'Reenviado').replace(/\.eml$/i, '');
        for (const n of nested) {
          const mapped = mapRow(n, {
            displayName: `${prefix} › ${n.name || 'adjunto'}`,
            sourceMessageId: innerMessageId,
          });
          if (mapped) result.push(mapped);
        }
      } else {
        const mapped = mapRow(row, { displayName: row.name || 'Correo reenviado' });
        if (mapped) result.push(mapped);
      }
    } else {
      const mapped = mapRow(row);
      if (mapped) result.push(mapped);
    }
  }

  return result;
}

export async function downloadFileAttachmentBuffer(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const url = `${GRAPH_BASE}/me/messages/${outlookMessagePathId(messageId)}/attachments/${outlookMessagePathId(attachmentId)}/$value`;
  const res = await graphFetch(accessToken, url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`No se pudo descargar adjunto (${res.status}): ${text.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function attachmentFingerprint(name: string, size: number): string {
  return `${size}:${name.trim().toLowerCase()}`;
}

async function buffersFromItemAttachment(
  accessToken: string,
  parentMessageId: string,
  attachmentId: string,
  displayName: string
): Promise<ParseSessionRow[]> {
  const mime = await downloadItemAttachmentMime(accessToken, parentMessageId, attachmentId);
  if (!mime?.length) return [];

  try {
    const parsed = await simpleParser(mime);
    const rows: ParseSessionRow[] = [];
    let order = 0;
    for (const att of parsed.attachments || []) {
      const ct = String(att.contentType || '');
      if (ct.startsWith('image/')) continue;
      const buf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content || []);
      if (!buf.length) continue;
      const name = String(att.filename || `adjunto-${order + 1}`);
      rows.push({
        sessionIndex: order,
        filename: name,
        originalName: `${displayName} › ${name}`,
        contentType: ct || 'application/octet-stream',
        size: buf.length,
        buffer: buf,
        order: order++,
      });
    }
    return rows;
  } catch (e) {
    console.warn('[outlook] parse itemAttachment MIME:', (e as Error)?.message || e);
    return [];
  }
}

/**
 * Completa la sesión de parse con adjuntos de Graph (incluye reenvíos con itemAttachment).
 */
export async function supplementParseSessionFromGraphAttachments(
  accessToken: string,
  messageId: string,
  existing: ParseSessionRow[]
): Promise<ParseSessionRow[]> {
  const meta = await listMessageAttachmentsMeta(accessToken, messageId);
  const seen = new Set(existing.map((a) => attachmentFingerprint(a.originalName || a.filename, a.size)));

  const extra: ParseSessionRow[] = [];
  let order = existing.length;

  const pushRow = (row: Omit<ParseSessionRow, 'sessionIndex' | 'order'>) => {
    const fp = attachmentFingerprint(row.originalName || row.filename, row.size);
    if (seen.has(fp)) return;
    extra.push({
      ...row,
      sessionIndex: order,
      order: order++,
    });
    seen.add(fp);
  };

  for (const att of meta) {
    if (att.kind === 'file' && !att.isInline) {
      try {
        const msgId = att.sourceMessageId || messageId;
        const buffer = await downloadFileAttachmentBuffer(accessToken, msgId, att.id);
        if (!buffer.length) continue;
        pushRow({
          filename: att.name,
          originalName: att.name,
          contentType: att.contentType,
          size: buffer.length,
          buffer,
        });
      } catch (e) {
        console.warn(`[outlook] adjunto ${att.name}:`, (e as Error)?.message || e);
      }
    } else if (att.kind === 'item') {
      const fromMime = await buffersFromItemAttachment(accessToken, messageId, att.id, att.name);
      for (const row of fromMime) {
        pushRow({
          filename: row.filename,
          originalName: row.originalName || row.filename,
          contentType: row.contentType,
          size: row.size,
          buffer: row.buffer,
        });
      }
    }
  }

  if (!extra.length) return existing;
  return [...existing, ...extra.map((row, i) => ({ ...row, sessionIndex: existing.length + i }))];
}

function safeAttachmentFilename(name: string): string {
  const base = String(name || 'adjunto')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim();
  return base.slice(0, 180) || 'adjunto';
}

/** Descarga el contenido binario de un adjunto listado por `listMessageAttachmentsMeta`. */
export async function downloadOutlookAttachmentContent(
  accessToken: string,
  outerMessageId: string,
  att: Pick<OutlookAttachmentMeta, 'id' | 'kind' | 'sourceMessageId' | 'name' | 'contentType'>
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  if (att.kind === 'reference') {
    throw new Error('Este adjunto está en OneDrive. Ábralo desde Outlook web o la aplicación de escritorio.');
  }
  if (att.kind === 'file') {
    const msgId = att.sourceMessageId || outerMessageId;
    const buffer = await downloadFileAttachmentBuffer(accessToken, msgId, att.id);
    if (!buffer.length) throw new Error('El adjunto está vacío.');
    return {
      buffer,
      contentType: att.contentType || 'application/octet-stream',
      filename: safeAttachmentFilename(att.name),
    };
  }
  if (att.kind === 'item') {
    const rows = await buffersFromItemAttachment(accessToken, outerMessageId, att.id, att.name);
    if (rows.length === 1 && rows[0].buffer?.length) {
      return {
        buffer: rows[0].buffer,
        contentType: rows[0].contentType || 'application/octet-stream',
        filename: safeAttachmentFilename(rows[0].originalName || rows[0].filename),
      };
    }
    if (rows.length > 1) {
      throw new Error(
        `Este correo embebido tiene ${rows.length} archivos. Use los adjuntos listados con prefijo «Reenviado ›».`
      );
    }
    throw new Error('No se pudo leer el correo embebido.');
  }
  throw new Error('Tipo de adjunto no soportado para descarga.');
}
