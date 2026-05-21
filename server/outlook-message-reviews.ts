import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassifyJudicialEmailResult } from './classify-judicial-email';
import type { OutlookAttachmentMeta } from './outlook-graph-attachments';

export type OutlookReviewStatus = 'pending' | 'rejected' | 'ingested';

export type ProposedIngestPiece =
  | { kind: 'email_body'; name: string; label: string }
  | {
      kind: 'attachment';
      sessionIndex: number;
      name: string;
      label: string;
      contentType: string;
      size: number;
    };

export type OutlookMessageReviewRow = {
  id: string;
  court_id: string;
  created_by: string;
  outlook_message_id: string;
  parse_session_id: string | null;
  subject: string;
  from_address: string | null;
  received_at: string | null;
  status: OutlookReviewStatus;
  classification: Record<string, unknown>;
  proposed_case_id: string | null;
  attachment_manifest: OutlookAttachmentMeta[];
  proposed_ingest: ProposedIngestPiece[];
  ingest_result: Record<string, unknown> | null;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

function constanciaCorreoName(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `ConstanciaCorreo${y}${m}${day}`;
}

export function buildProposedIngest(
  attachmentRows: Array<{
    sessionIndex: number;
    filename: string;
    originalName?: string;
    contentType: string;
    size: number;
  }>,
  receivedAt?: Date
): ProposedIngestPiece[] {
  const pieces: ProposedIngestPiece[] = [
    {
      kind: 'email_body',
      name: constanciaCorreoName(receivedAt ?? new Date()),
      label: 'Constancia del correo (metadatos y cuerpo en expediente)',
    },
  ];
  for (const att of attachmentRows) {
    if (String(att.contentType || '').startsWith('image/')) continue;
    pieces.push({
      kind: 'attachment',
      sessionIndex: att.sessionIndex,
      name: att.filename,
      label: att.originalName || att.filename,
      contentType: att.contentType || 'application/octet-stream',
      size: att.size,
    });
  }
  return pieces;
}

function pickProposedCaseId(classification: ClassifyJudicialEmailResult): string | null {
  if (classification.expediente_vinculado_id) return classification.expediente_vinculado_id;
  if (classification.vinculo_expediente === 'encontrado' && classification.casos_candidatos[0]) {
    return classification.casos_candidatos[0].id;
  }
  return null;
}

export async function upsertOutlookMessageReview(opts: {
  admin: SupabaseClient;
  courtId: string;
  userId: string;
  outlookMessageId: string;
  parseSessionId: string;
  subject: string;
  fromAddress: string | null;
  receivedAt: string | null;
  classification: ClassifyJudicialEmailResult;
  bodyPreview: string;
  attachmentManifest: OutlookAttachmentMeta[];
  sessionAttachments: Array<{
    sessionIndex: number;
    filename: string;
    originalName?: string;
    contentType: string;
    size: number;
  }>;
}): Promise<{ id: string }> {
  const {
    admin,
    courtId,
    userId,
    outlookMessageId,
    parseSessionId,
    subject,
    fromAddress,
    receivedAt,
    classification,
    bodyPreview,
    attachmentManifest,
    sessionAttachments,
  } = opts;

  const receivedDate = receivedAt ? new Date(receivedAt) : new Date();
  const proposedIngest = buildProposedIngest(sessionAttachments, receivedDate);
  const proposedCaseId = pickProposedCaseId(classification);

  const classificationPayload = {
    ...classification,
    body_preview: bodyPreview.slice(0, 8000),
  };

  const { data: existing } = await admin
    .from('outlook_message_reviews')
    .select('id, status')
    .eq('court_id', courtId)
    .eq('outlook_message_id', outlookMessageId)
    .eq('status', 'pending')
    .maybeSingle();

  const row = {
    court_id: courtId,
    created_by: userId,
    outlook_message_id: outlookMessageId,
    parse_session_id: parseSessionId,
    subject,
    from_address: fromAddress,
    received_at: receivedAt,
    status: 'pending' as const,
    classification: classificationPayload,
    proposed_case_id: proposedCaseId,
    attachment_manifest: attachmentManifest,
    proposed_ingest: proposedIngest,
    ingest_result: null,
    reject_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await admin
      .from('outlook_message_reviews')
      .update(row)
      .eq('id', existing.id)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { id: String(data.id) };
  }

  const { data, error } = await admin
    .from('outlook_message_reviews')
    .insert({ ...row, created_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: String(data.id) };
}

export async function listOutlookMessageReviews(
  admin: SupabaseClient,
  courtId: string,
  status: OutlookReviewStatus = 'pending'
): Promise<OutlookMessageReviewRow[]> {
  const { data, error } = await admin
    .from('outlook_message_reviews')
    .select('*')
    .eq('court_id', courtId)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as OutlookMessageReviewRow[];
}

export async function getOutlookMessageReview(
  admin: SupabaseClient,
  courtId: string,
  reviewId: string
): Promise<OutlookMessageReviewRow | null> {
  const { data, error } = await admin
    .from('outlook_message_reviews')
    .select('*')
    .eq('id', reviewId)
    .eq('court_id', courtId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OutlookMessageReviewRow) ?? null;
}
