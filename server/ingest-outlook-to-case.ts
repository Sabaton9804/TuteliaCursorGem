import type { SupabaseClient } from '@supabase/supabase-js';
import { getParseSession } from './parse-email-sessions';
import { parseOutlookMessageToSession } from './parse-outlook-message';
import { supplementParseSessionFromGraphAttachments } from './outlook-graph-attachments';
import { replaceParseSessionAttachments } from './parse-email-sessions';
import type { ParseSessionRow } from './parse-email-sessions';
import type { OutlookMessageReviewRow } from './outlook-message-reviews';
import {
  DEFAULT_NOTEBOOK_CODE,
  insertCaseDocumentRowsAdmin,
  nextSortOrderForCase,
  removeCaseDocumentObjectsAdmin,
  sanitizeCaseDocumentLogicalName,
  uploadCaseAttachmentAdmin,
} from './case-document-storage';

export type IngestOutlookResult = {
  documentsCreated: number;
  storagePaths: string[];
  documentIds: string[];
};

async function resolveSessionAttachments(
  accessToken: string,
  messageId: string,
  parseSessionId: string | null
): Promise<ParseSessionRow[]> {
  if (parseSessionId) {
    const session = getParseSession(parseSessionId);
    if (session?.attachments?.length) {
      let attachments = session.attachments;
      const merged = await supplementParseSessionFromGraphAttachments(
        accessToken,
        messageId,
        attachments
      );
      if (merged.length !== attachments.length) {
        replaceParseSessionAttachments(parseSessionId, merged);
        attachments = merged;
      }
      return attachments;
    }
  }
  const { parsed, attachments } = await parseOutlookMessageToSession(messageId, accessToken);
  if (parsed.parseSessionId && attachments.length) {
    replaceParseSessionAttachments(parsed.parseSessionId, attachments);
  }
  return attachments;
}

async function assertCaseInCourt(
  admin: SupabaseClient,
  caseId: string,
  courtId: string
): Promise<{ radicado: string }> {
  const { data, error } = await admin
    .from('cases')
    .select('id, court_id, radicado')
    .eq('id', caseId)
    .maybeSingle();
  if (error || !data) throw new Error('Expediente no encontrado.');
  if (String(data.court_id) !== courtId) throw new Error('El expediente no pertenece a su despacho.');
  return { radicado: String(data.radicado || '') };
}

export async function ingestOutlookReviewToCase(opts: {
  admin: SupabaseClient;
  accessToken: string;
  courtId: string;
  userId: string;
  review: OutlookMessageReviewRow;
  caseId: string;
}): Promise<IngestOutlookResult> {
  const { admin, accessToken, courtId, userId, review, caseId } = opts;

  if (review.status !== 'pending') {
    throw new Error('Este correo ya fue revisado.');
  }

  await assertCaseInCourt(admin, caseId, courtId);

  const attachments = await resolveSessionAttachments(
    accessToken,
    review.outlook_message_id,
    review.parse_session_id
  );

  const classification = review.classification as {
    body_preview?: string;
    subject?: string;
  };
  const bodyPreview = String(classification.body_preview || '');
  const subject = String(review.subject || classification.subject || 'Correo judicial');

  let sortOrder = await nextSortOrderForCase(admin, caseId);
  const uploadedPaths: string[] = [];
  const docRows: Array<Record<string, unknown>> = [];

  const constanciaName =
    review.proposed_ingest.find((p) => p.kind === 'email_body')?.name || 'ConstanciaCorreoDespacho';

  docRows.push({
    case_id: caseId,
    name: constanciaName,
    original_name: `${subject.slice(0, 120)}.eml`,
    type: 'email_body',
    size: Math.max(bodyPreview.length, 1),
    sort_order: sortOrder++,
    is_from_link: false,
    notebook_code: DEFAULT_NOTEBOOK_CODE,
  });

  const proposedAtts = review.proposed_ingest.filter((p) => p.kind === 'attachment');
  const indices = new Set(proposedAtts.map((p) => p.sessionIndex));

  for (const att of attachments) {
    if (!indices.has(att.sessionIndex)) continue;
    if (String(att.contentType || '').startsWith('image/')) continue;
    if (!att.buffer?.length) continue;

    const logical = sanitizeCaseDocumentLogicalName(
      att.originalName || att.filename,
      `adjunto-${att.sessionIndex + 1}.pdf`
    );
    const up = await uploadCaseAttachmentAdmin(
      admin,
      caseId,
      logical,
      att.buffer,
      att.contentType || 'application/octet-stream'
    );
    if ('error' in up) {
      await removeCaseDocumentObjectsAdmin(admin, uploadedPaths);
      throw up.error;
    }
    uploadedPaths.push(up.path);
    docRows.push({
      case_id: caseId,
      name: logical.replace(/\.pdf$/i, ''),
      original_name: att.originalName || att.filename,
      type: 'attachment',
      size: att.buffer.length,
      content_type: att.contentType || 'application/octet-stream',
      storage_path: up.path,
      is_from_link: false,
      sort_order: sortOrder++,
      notebook_code: DEFAULT_NOTEBOOK_CODE,
    });
  }

  if (docRows.length === 0) {
    throw new Error('No hay piezas para ingresar (sin adjuntos descargables).');
  }

  const ins = await insertCaseDocumentRowsAdmin(admin, docRows);
  if (ins.error) {
    await removeCaseDocumentObjectsAdmin(admin, uploadedPaths);
    throw new Error(ins.error.message);
  }

  const now = new Date().toISOString();
  const ingestResult: IngestOutlookResult = {
    documentsCreated: docRows.length,
    storagePaths: uploadedPaths,
    documentIds: [],
  };

  const { error: updErr } = await admin
    .from('outlook_message_reviews')
    .update({
      status: 'ingested',
      proposed_case_id: caseId,
      ingest_result: ingestResult,
      reviewed_by: userId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', review.id)
    .eq('court_id', courtId);

  if (updErr) {
    console.error('[outlook-ingest] review update failed:', updErr.message);
  }

  return ingestResult;
}
