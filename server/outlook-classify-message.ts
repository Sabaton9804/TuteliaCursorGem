import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyJudicialEmail, type ClassifyJudicialEmailResult } from './classify-judicial-email';
import {
  downloadOutlookAttachmentContent,
  listMessageAttachmentsMeta,
  type OutlookAttachmentMeta,
} from './outlook-graph-attachments';
import { getMessageDetail } from './outlook-graph';
import { outlookMessageBodyText } from './outlook-message-body';
import {
  createParseSession,
  getParseSession,
  type ParseSessionRow,
} from './parse-email-sessions';
import { upsertOutlookMessageReview } from './outlook-message-reviews';

export type ClassifyEnqueueResult = ClassifyJudicialEmailResult & { reviewId?: string };

/** Clasificación liviana: cuerpo + asunto primero; un solo PDF solo si hace falta. Sin descargar MIME completo. */
export async function classifyAndEnqueueOutlookMessage(opts: {
  admin: SupabaseClient;
  accessToken: string;
  courtId: string;
  userId: string;
  messageId: string;
  parseSessionId?: string;
}): Promise<ClassifyEnqueueResult> {
  const { admin, accessToken, courtId, userId, messageId } = opts;

  const detail = await getMessageDetail(accessToken, messageId);
  const subject = String(detail.subject ?? '');
  const bodyText =
    outlookMessageBodyText(detail) || String((detail as { bodyPreview?: string }).bodyPreview ?? '');

  let parseSessionId = opts.parseSessionId?.trim() || '';
  let attachments: ParseSessionRow[] = [];
  const existing = parseSessionId ? getParseSession(parseSessionId) : undefined;
  if (existing) {
    attachments = existing.attachments.filter((a) => a.buffer?.length);
  } else {
    parseSessionId = createParseSession([]);
  }

  let manifest: OutlookAttachmentMeta[] = [];
  try {
    manifest = await listMessageAttachmentsMeta(accessToken, messageId);
  } catch (e) {
    console.warn('[outlook/classify] manifest:', (e as Error)?.message || e);
  }

  const attachmentNames = manifest.map((m) => m.name);

  const fetchFirstPdf = async (): Promise<{ buffer: Buffer; filename: string } | null> => {
    const pick =
      manifest.find(
        (m) =>
          m.kind === 'file' &&
          !m.isInline &&
          (m.contentType === 'application/pdf' || m.name.toLowerCase().endsWith('.pdf'))
      ) ?? manifest.find((m) => m.kind === 'file' && !m.isInline);
    if (!pick) return null;
    try {
      const { buffer, filename } = await downloadOutlookAttachmentContent(accessToken, messageId, pick);
      if (!buffer.length) return null;
      return { buffer, filename };
    } catch (e) {
      console.warn('[outlook/classify] primer PDF:', (e as Error)?.message || e);
      return null;
    }
  };

  const result = await classifyJudicialEmail({
    subject,
    bodyText,
    attachments,
    attachmentNames,
    fetchFirstPdf,
    courtId,
    supabaseAdmin: admin,
    parseSessionId,
  });

  let reviewId: string | undefined;
  try {
    const fromAddr =
      detail.from && typeof detail.from === 'object'
        ? String(
            (detail.from as { emailAddress?: { address?: string } }).emailAddress?.address || ''
          )
        : null;
    const receivedAt =
      typeof detail.receivedDateTime === 'string' ? detail.receivedDateTime : null;

    const sessionAttachments = manifest
      .filter((m) => m.kind === 'file' && !m.isInline)
      .map((m, i) => ({
        sessionIndex: i,
        filename: m.name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120) || `adjunto-${i + 1}`,
        originalName: m.name,
        contentType: m.contentType || 'application/octet-stream',
        size: m.size,
      }));

    const { id } = await upsertOutlookMessageReview({
      admin,
      courtId,
      userId,
      outlookMessageId: messageId,
      parseSessionId,
      subject,
      fromAddress: fromAddr || null,
      receivedAt,
      classification: result,
      bodyPreview: bodyText,
      attachmentManifest: manifest,
      sessionAttachments,
    });
    reviewId = id;
  } catch (e) {
    console.warn('[outlook/classify] cola:', (e as Error)?.message || e);
  }

  return { ...result, reviewId };
}

export type InboxScanItem = {
  messageId: string;
  subject: string;
  ok: boolean;
  reviewId?: string;
  error?: string;
  skipped?: boolean;
};

/** Analiza correos recientes de la bandeja y los envía a Pendientes (uno por uno, cola Graph). */
export async function scanInboxIntoReviewQueue(opts: {
  admin: SupabaseClient;
  accessToken: string;
  courtId: string;
  userId: string;
  folder?: import('./outlook-graph').OutlookFolderKey;
  top?: number;
}): Promise<{ processed: InboxScanItem[]; queued: number; failed: number; skipped: number }> {
  const { admin, accessToken, courtId, userId } = opts;
  const folder = opts.folder ?? 'inbox';
  const top = Math.min(Math.max(opts.top ?? 20, 1), 30);

  const { listFolderMessages } = await import('./outlook-graph');
  const messages = await listFolderMessages(accessToken, folder, { top });

  const processed: InboxScanItem[] = [];
  let queued = 0;
  let failed = 0;
  let skipped = 0;

  for (const msg of messages) {
    const messageId = String(msg.id || '');
    const subject = String(msg.subject || '(Sin asunto)');
    if (!messageId) continue;

    const { data: existing } = await admin
      .from('outlook_message_reviews')
      .select('id, status')
      .eq('court_id', courtId)
      .eq('outlook_message_id', messageId)
      .in('status', ['pending', 'ingested'])
      .maybeSingle();

    if (existing?.id) {
      skipped++;
      processed.push({ messageId, subject, ok: true, skipped: true });
      continue;
    }

    try {
      const result = await classifyAndEnqueueOutlookMessage({
        admin,
        accessToken,
        courtId,
        userId,
        messageId,
      });
      queued++;
      processed.push({
        messageId,
        subject,
        ok: true,
        reviewId: result.reviewId,
      });
    } catch (e) {
      failed++;
      processed.push({
        messageId,
        subject,
        ok: false,
        error: String((e as Error).message || e),
      });
    }
  }

  return { processed, queued, failed, skipped };
}
