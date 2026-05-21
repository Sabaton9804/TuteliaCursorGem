import { supabase } from './supabase';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';

function parseOutlookClientError(status: number, body: { error?: string }): string {
  const serverMsg = typeof body.error === 'string' ? body.error.trim() : '';
  if (serverMsg) return serverMsg;
  if (status === 401) {
    return 'Sesión de Tutelia inválida o expirada. Cierre sesión, vuelva a entrar (Google, Microsoft 365 o admin) e intente de nuevo.';
  }
  return `Error del servidor (${status}).`;
}

async function authHeaders(): Promise<HeadersInit> {
  await ensureSupabaseSessionForWrites();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error(
      'Inicie sesión en Tutelia (no use solo modo local sin Supabase) para conectar Outlook.'
    );
  }
  return { Authorization: `Bearer ${token}` };
}

export type OutlookStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  mailboxEmail: string | null;
  /** URI que debe estar registrada en Microsoft Entra (Autenticación → Web). */
  redirectUri?: string;
};

export type OutlookFolderKey = 'inbox' | 'drafts' | 'sentitems' | 'deleteditems' | 'junkemail';

export type OutlookFolderSummary = {
  id: OutlookFolderKey;
  label: string;
  total: number;
  unread: number;
};

export type OutlookAttachmentMeta = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  kind: 'file' | 'reference' | 'item' | 'other';
  isInline: boolean;
  sourceMessageId?: string;
};

export type OutlookMessageSummary = {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  lastModifiedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
};

export async function fetchOutlookStatus(): Promise<OutlookStatus> {
  const res = await fetch('/api/outlook/status', { headers: await authHeaders() });
  if (!res.ok) throw new Error('No se pudo consultar Outlook.');
  return (await res.json()) as OutlookStatus;
}

export async function fetchOutlookAuthUrl(): Promise<string> {
  const res = await fetch('/api/outlook/auth-url', { headers: await authHeaders() });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw new Error(parseOutlookClientError(res.status, j));
  if (!j.url) throw new Error('Respuesta inválida del servidor.');
  return j.url;
}

export async function disconnectOutlook(): Promise<void> {
  const res = await fetch('/api/outlook/disconnect', { method: 'DELETE', headers: await authHeaders() });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || 'No se pudo desconectar.');
  }
}

export async function fetchOutlookFolders(): Promise<OutlookFolderSummary[]> {
  const res = await fetch('/api/outlook/folders', { headers: await authHeaders() });
  const j = (await res.json().catch(() => ({}))) as { folders?: OutlookFolderSummary[]; error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al consultar carpetas.');
  return j.folders ?? [];
}

export async function fetchOutlookMessages(opts?: {
  top?: number;
  skip?: number;
  search?: string;
  folder?: OutlookFolderKey;
}): Promise<OutlookMessageSummary[]> {
  const params = new URLSearchParams();
  if (opts?.top) params.set('top', String(opts.top));
  if (opts?.skip) params.set('skip', String(opts.skip));
  if (opts?.search?.trim()) params.set('search', opts.search.trim());
  if (opts?.folder) params.set('folder', opts.folder);
  const qs = params.toString();
  const res = await fetch(`/api/outlook/messages${qs ? `?${qs}` : ''}`, { headers: await authHeaders() });
  const j = (await res.json().catch(() => ({}))) as { messages?: OutlookMessageSummary[]; error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al cargar la bandeja.');
  return j.messages ?? [];
}

export async function fetchOutlookMessageAttachments(messageId: string): Promise<OutlookAttachmentMeta[]> {
  const res = await fetch(`/api/outlook/messages/${encodeURIComponent(messageId)}/attachments`, {
    headers: await authHeaders(),
  });
  const j = (await res.json().catch(() => ({}))) as { attachments?: OutlookAttachmentMeta[]; error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al listar adjuntos.');
  return j.attachments ?? [];
}

function outlookAttachmentDownloadUrl(
  messageId: string,
  att: OutlookAttachmentMeta,
  disposition: 'inline' | 'attachment'
): string {
  const params = new URLSearchParams({
    kind: att.kind,
    name: att.name,
    contentType: att.contentType || 'application/octet-stream',
    disposition,
  });
  if (att.sourceMessageId) params.set('sourceMessageId', att.sourceMessageId);
  return `/api/outlook/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(att.id)}?${params}`;
}

/** Descarga o vista previa de un adjunto (requiere sesión Tutelia en cabecera). */
export async function fetchOutlookAttachmentBytes(
  messageId: string,
  att: OutlookAttachmentMeta
): Promise<Uint8Array> {
  const res = await fetch(outlookAttachmentDownloadUrl(messageId, att, 'inline'), {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Abre el adjunto en una pestaña nueva (PDF u otros tipos que el navegador pueda mostrar). */
export async function openOutlookAttachmentInNewTab(
  messageId: string,
  att: OutlookAttachmentMeta
): Promise<void> {
  const bytes = await fetchOutlookAttachmentBytes(messageId, att);
  const blob = new Blob([bytes], { type: att.contentType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Descarga el adjunto al disco del usuario. */
export async function downloadOutlookAttachment(
  messageId: string,
  att: OutlookAttachmentMeta
): Promise<void> {
  const bytes = await fetchOutlookAttachmentBytes(messageId, att);
  const blob = new Blob([bytes], { type: att.contentType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = att.name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 180) || 'adjunto';
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchOutlookMessage(messageId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/outlook/messages/${encodeURIComponent(messageId)}`, {
    headers: await authHeaders(),
  });
  const j = (await res.json().catch(() => ({}))) as { message?: Record<string, unknown>; error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al leer el mensaje.');
  return j.message ?? {};
}

export async function parseOutlookMessageForRadicacion(messageId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/outlook/messages/${encodeURIComponent(messageId)}/parse`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al procesar el correo.');
  return j;
}

export type VinculoExpediente = 'encontrado' | 'no_encontrado' | 'ambiguo' | 'no_aplica';

export type OutlookEmailClasificacion = {
  tipo: 'reparto_nuevo' | 'respuesta_tramite' | 'impugnacion' | 'otro';
  descripcion_breve: string;
  confianza: 'alta' | 'media' | 'baja';
  radicado_referencia: string | null;
  referencia_proceso?: string | null;
  vinculo_expediente?: VinculoExpediente;
  expediente_vinculado_id?: string | null;
  accionante: string | null;
  accionado: string | null;
  casos_candidatos: Array<{
    id: string;
    radicado: string;
    claimant: string;
    defendant: string;
    etapa_actual: string;
  }>;
  parseSessionId: string;
  reviewId?: string;
};

export type OutlookReviewStatus = 'pending' | 'rejected' | 'ingested';

export type OutlookProposedIngestPiece =
  | { kind: 'email_body'; name: string; label: string }
  | {
      kind: 'attachment';
      sessionIndex: number;
      name: string;
      label: string;
      contentType: string;
      size: number;
    };

export type OutlookMessageReview = {
  id: string;
  court_id: string;
  outlook_message_id: string;
  parse_session_id: string | null;
  subject: string;
  from_address: string | null;
  received_at: string | null;
  status: OutlookReviewStatus;
  classification: OutlookEmailClasificacion & { body_preview?: string };
  proposed_case_id: string | null;
  attachment_manifest: OutlookAttachmentMeta[];
  proposed_ingest: OutlookProposedIngestPiece[];
  ingest_result: Record<string, unknown> | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchOutlookReviews(
  status: OutlookReviewStatus = 'pending'
): Promise<OutlookMessageReview[]> {
  const res = await fetch(`/api/outlook/reviews?status=${encodeURIComponent(status)}`, {
    headers: await authHeaders(),
  });
  const j = (await res.json().catch(() => ({}))) as { reviews?: OutlookMessageReview[]; error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al cargar pendientes.');
  return j.reviews ?? [];
}

export async function fetchOutlookReview(reviewId: string): Promise<OutlookMessageReview> {
  const res = await fetch(`/api/outlook/reviews/${encodeURIComponent(reviewId)}`, {
    headers: await authHeaders(),
  });
  const j = (await res.json().catch(() => ({}))) as { review?: OutlookMessageReview; error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al cargar el pendiente.');
  if (!j.review) throw new Error('Pendiente no encontrado.');
  return j.review;
}

export async function approveOutlookReview(
  reviewId: string,
  caseId: string
): Promise<{ caseId: string; ingest: { documentsCreated: number } }> {
  const res = await fetch(`/api/outlook/reviews/${encodeURIComponent(reviewId)}/approve`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId }),
  });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    caseId?: string;
    ingest?: { documentsCreated: number };
    error?: string;
  };
  if (!res.ok) throw new Error(j.error || 'Error al aprobar ingreso.');
  return { caseId: String(j.caseId), ingest: j.ingest ?? { documentsCreated: 0 } };
}

export type InboxScanSummary = {
  queued: number;
  failed: number;
  skipped: number;
  processed: Array<{
    messageId: string;
    subject: string;
    ok: boolean;
    reviewId?: string;
    error?: string;
    skipped?: boolean;
  }>;
};

/** Analiza los correos visibles de la bandeja de entrada y los envía a Pendientes. */
export async function scanOutlookInbox(opts?: {
  top?: number;
  folder?: OutlookFolderKey;
}): Promise<InboxScanSummary> {
  const res = await fetch('/api/outlook/inbox/scan', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ top: opts?.top ?? 20, folder: opts?.folder ?? 'inbox' }),
  });
  const j = (await res.json().catch(() => ({}))) as InboxScanSummary & { error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al analizar la bandeja.');
  return j;
}

export async function rejectOutlookReview(reviewId: string, reason?: string): Promise<void> {
  const res = await fetch(`/api/outlook/reviews/${encodeURIComponent(reviewId)}/reject`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al descartar.');
}

export async function classifyOutlookMessage(
  messageId: string,
  opts?: { parseSessionId?: string }
): Promise<OutlookEmailClasificacion> {
  const res = await fetch(`/api/outlook/messages/${encodeURIComponent(messageId)}/classify`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(opts?.parseSessionId ? { parseSessionId: opts.parseSessionId } : {}),
  });
  const j = (await res.json().catch(() => ({}))) as OutlookEmailClasificacion & { error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al analizar el correo.');
  return j;
}

export async function sendOutlookMail(payload: {
  subject: string;
  bodyHtml: string;
  to: string[];
  cc?: string[];
}): Promise<void> {
  const res = await fetch('/api/outlook/send', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error || 'Error al enviar el correo.');
}
