import express, { type Express, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { outlookIntegrationState } from './outlook-config';
import {
  buildOutlookAuthorizeUrl,
  disconnectOutlook,
  getMessageDetail,
  getOutlookConnection,
  getMailFolderOverview,
  listFolderMessages,
  parseOutlookFolderKey,
  saveOutlookConnectionFromAuthCode,
  sendMail,
} from './outlook-graph';
import { requireAuthenticatedCaller, signOutlookOAuthState, verifyOutlookOAuthState } from './outlook-auth';
import { parseOutlookMessageToSession } from './parse-outlook-message';
import { parseSegundaInstanciaFromEmail } from './sgde-segunda-instancia-parse';
import {
  downloadOutlookAttachmentContent,
  listMessageAttachmentsMeta,
  type OutlookAttachmentKind,
} from './outlook-graph-attachments';
import {
  getOutlookContextSnapshot,
  resolveOutlookContext,
  setUserOutlookMailboxContext,
} from './outlook-mailbox-context';
import { isOutlookAllowLegacyMe } from './outlook-config';
import { ingestOutlookReviewToCase } from './ingest-outlook-to-case';
import {
  classifyAndEnqueueOutlookMessage,
  scanInboxIntoReviewQueue,
} from './outlook-classify-message';
import {
  requiereVinculoExpediente,
  type ClassifyJudicialEmailResult,
} from './classify-judicial-email';
import {
  getOutlookMessageReview,
  listOutlookMessageReviews,
} from './outlook-message-reviews';

const CLASSIFY_ENDPOINT_TIMEOUT_MS = 55_000;
const INBOX_SCAN_TIMEOUT_MS = 600_000;

function appOrigin(): string {
  const fromEnv = (process.env.APP_URL || process.env.VITE_APP_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return `http://localhost:${process.env.PORT || '3000'}`;
}

const OUTLOOK_API_BUILD = '2026-06-05-shared-mailbox-v0.4';

async function resolveCtxOrRespond(
  req: Request,
  res: Response,
  getSupabaseAdmin: () => SupabaseClient
) {
  const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
  if (auth.ok === false) {
    res.status(auth.status).json({ error: auth.message });
    return null;
  }
  const resolved = await resolveOutlookContext(req, auth.admin, auth.userId);
  if (resolved.ok === false) {
    res.status(resolved.status).json({ error: resolved.message });
    return null;
  }
  return { auth, ctx: resolved.ctx };
}

export function registerOutlookRoutes(app: Express, getSupabaseAdmin: () => SupabaseClient) {
  console.info(
    `[tutelia] Outlook API (${OUTLOOK_API_BUILD}): shared mailbox, context, status, folders, messages, classify, send`
  );

  app.get('/api/outlook/status', async (req, res) => {
    const integration = outlookIntegrationState();
    const base = { ...integration };
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) {
      return res.json({ ...base, connected: false, mailboxEmail: null });
    }
    try {
      const row = await getOutlookConnection(auth.admin, auth.userId);
      const snap = row ? await getOutlookContextSnapshot(auth.admin, auth.userId) : null;
      const activeMb = snap?.activeMailboxId
        ? snap.mailboxes.find((m) => m.id === snap.activeMailboxId)
        : null;
      return res.json({
        ...base,
        connected: Boolean(row),
        mailboxEmail: row?.mailbox_email ?? null,
        oauthAccountEmail: row?.mailbox_email ?? null,
        graphMode: row?.graph_mode ?? null,
        activeCourtId: snap?.activeCourtId ?? null,
        activeMailbox: activeMb
          ? {
              id: activeMb.id,
              upn: activeMb.mailbox_upn,
              displayName: activeMb.display_name,
              courtId: activeMb.court_id,
              courtName: activeMb.courtName,
            }
          : null,
        legacyMeAllowed: isOutlookAllowLegacyMe(),
        requireExplicitMailbox: snap?.requireExplicitMailbox ?? true,
        /** Permite comprobar que el servidor cargó la ruta POST .../classify */
        features: {
          classify: true,
          folders: true,
          attachments: true,
          attachmentDownload: true,
          reviewQueue: true,
          inboxScan: true,
          classifyLight: true,
          sharedMailbox: true,
          mailboxContext: true,
        },
        apiBuild: OUTLOOK_API_BUILD,
      });
    } catch (e) {
      console.error('outlook/status:', e);
      return res.status(500).json({ error: 'No se pudo consultar la conexión Outlook.' });
    }
  });

  app.get('/api/outlook/auth-url', async (req, res) => {
    const integration = outlookIntegrationState();
    if (!integration.enabled) {
      return res.status(503).json({
        error: 'Outlook no está habilitado. Configure OUTLOOK_CLIENT_ID y OUTLOOK_CLIENT_SECRET en el servidor.',
        ...integration,
      });
    }
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });
    const state = signOutlookOAuthState(auth.userId);
    return res.json({ url: buildOutlookAuthorizeUrl(auth.userId, state), redirectUri: integration.redirectUri });
  });

  app.get('/api/outlook/callback', async (req, res) => {
    const integration = outlookIntegrationState();
    const origin = appOrigin();
    const fail = (msg: string) => res.redirect(`${origin}/correo?outlook=error&message=${encodeURIComponent(msg)}`);

    if (!integration.enabled) return fail('Outlook no configurado en el servidor.');
    const err = typeof req.query.error === 'string' ? req.query.error : null;
    if (err) return fail(err);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) return fail('Faltan parámetros de autorización.');
    const userId = verifyOutlookOAuthState(state);
    if (!userId) return fail('Estado OAuth inválido o expirado. Intente conectar de nuevo.');

    try {
      const admin = getSupabaseAdmin();
      const { mailboxEmail } = await saveOutlookConnectionFromAuthCode(admin, userId, code);
      return res.redirect(`${origin}/correo?outlook=connected&mailbox=${encodeURIComponent(mailboxEmail)}`);
    } catch (e) {
      const msg = String((e as Error)?.message || 'Error al guardar la conexión.');
      console.error('outlook/callback:', msg, e);
      return fail(msg);
    }
  });

  app.get('/api/outlook/mailboxes', async (req, res) => {
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });
    try {
      const snap = await getOutlookContextSnapshot(auth.admin, auth.userId);
      return res.json({
        mailboxes: snap.mailboxes.map((m) => ({
          id: m.id,
          courtId: m.court_id,
          courtName: m.courtName,
          upn: m.mailbox_upn,
          displayName: m.display_name,
          isPrimary: m.is_primary,
        })),
        activeMailboxId: snap.activeMailboxId,
        activeCourtId: snap.activeCourtId,
        graphMode: snap.graphMode,
        legacyMeAllowed: snap.legacyMeAllowed,
        requireExplicitMailbox: snap.requireExplicitMailbox,
      });
    } catch (e) {
      console.error('outlook/mailboxes:', e);
      return res.status(500).json({ error: String((e as Error).message || 'Error al listar buzones.') });
    }
  });

  app.get('/api/outlook/context', async (req, res) => {
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });
    try {
      const snap = await getOutlookContextSnapshot(auth.admin, auth.userId);
      const activeMb = snap.activeMailboxId
        ? snap.mailboxes.find((m) => m.id === snap.activeMailboxId)
        : null;
      return res.json({
        activeMailboxId: snap.activeMailboxId,
        activeCourtId: snap.activeCourtId,
        graphMode: snap.graphMode,
        activeMailbox: activeMb
          ? {
              id: activeMb.id,
              upn: activeMb.mailbox_upn,
              displayName: activeMb.display_name,
              courtId: activeMb.court_id,
              courtName: activeMb.courtName,
            }
          : null,
        legacyMeAllowed: snap.legacyMeAllowed,
        requireExplicitMailbox: snap.requireExplicitMailbox,
      });
    } catch (e) {
      console.error('outlook/context GET:', e);
      return res.status(500).json({ error: String((e as Error).message || 'Error al consultar contexto.') });
    }
  });

  app.put('/api/outlook/context', async (req, res) => {
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });
    const mailboxId = String((req.body as { mailboxId?: string })?.mailboxId || '').trim();
    if (!mailboxId) return res.status(400).json({ error: 'Se requiere mailboxId.' });
    try {
      const { courtId, mailbox } = await setUserOutlookMailboxContext(auth.admin, auth.userId, mailboxId);
      return res.json({
        ok: true,
        courtId,
        activeMailbox: {
          id: mailbox.id,
          upn: mailbox.mailbox_upn,
          displayName: mailbox.display_name,
        },
        graphMode: 'shared_mailbox',
      });
    } catch (e) {
      const msg = String((e as Error).message || 'Error al guardar contexto.');
      const status = msg.includes('permiso') ? 403 : 400;
      console.error('outlook/context PUT:', msg);
      return res.status(status).json({ error: msg });
    }
  });

  app.delete('/api/outlook/disconnect', async (req, res) => {
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });
    try {
      await disconnectOutlook(auth.admin, auth.userId);
      return res.json({ ok: true });
    } catch (e) {
      console.error('outlook/disconnect:', e);
      return res.status(500).json({ error: String((e as Error)?.message || 'Error al desconectar.') });
    }
  });

  app.get('/api/outlook/folders', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    try {
      const folders = await getMailFolderOverview(pack.ctx.accessToken, pack.ctx.graphTarget);
      return res.json({ folders, graphMode: pack.ctx.graphMode, mailboxUpn: pack.ctx.mailboxUpn });
    } catch (e) {
      console.error('outlook/folders:', e);
      const msg = String((e as Error)?.message || '');
      if (msg.includes('no conectado')) return res.status(409).json({ error: msg });
      return res.status(502).json({ error: msg || 'Error al consultar carpetas.' });
    }
  });

  app.get('/api/outlook/messages', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    try {
      const top = parseInt(String(req.query.top || '30'), 10);
      const skip = parseInt(String(req.query.skip || '0'), 10);
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const folder = parseOutlookFolderKey(typeof req.query.folder === 'string' ? req.query.folder : undefined);
      const messages = await listFolderMessages(pack.ctx.accessToken, pack.ctx.graphTarget, folder, {
        top,
        skip,
        search,
      });
      return res.json({ messages, folder, graphMode: pack.ctx.graphMode });
    } catch (e) {
      console.error('outlook/messages:', e);
      const msg = String((e as Error)?.message || '');
      if (msg.includes('no conectado')) return res.status(409).json({ error: msg });
      return res.status(502).json({ error: msg || 'Error al listar correos.' });
    }
  });

  const messageRouter = express.Router();
  const REVIEW_STATUS_MAX_IDS = 200;

  messageRouter.post('/review-status', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;

    const raw = (req.body as { messageIds?: unknown })?.messageIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ error: 'Se requiere array messageIds.' });
    }
    const messageIds = [
      ...new Set(raw.map((id) => String(id).trim()).filter(Boolean)),
    ].slice(0, REVIEW_STATUS_MAX_IDS);

    const result: Record<string, 'pending' | 'ingested' | null> = {};
    for (const id of messageIds) result[id] = null;

    const { data, error } = await pack.auth.admin
      .from('outlook_message_reviews')
      .select('outlook_message_id, status')
      .eq('court_id', pack.ctx.courtId)
      .in('outlook_message_id', messageIds)
      .in('status', ['pending', 'ingested']);

    if (error) {
      console.error('outlook/review-status:', error.message);
      return res.status(500).json({ error: error.message });
    }

    for (const row of data || []) {
      const mid = String(row.outlook_message_id || '');
      if (!mid) continue;
      if (row.status === 'pending') result[mid] = 'pending';
      else if (row.status === 'ingested' && result[mid] !== 'pending') result[mid] = 'ingested';
    }

    return res.json(result);
  });

  messageRouter.get('/:messageId/attachments/:attachmentId', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const messageId = String(req.params.messageId || '').trim();
    const attachmentId = String(req.params.attachmentId || '').trim();
    if (!messageId || !attachmentId) {
      return res.status(400).json({ error: 'messageId y attachmentId requeridos.' });
    }
    const kind = String(req.query.kind || 'file') as OutlookAttachmentKind;
    const name = typeof req.query.name === 'string' ? req.query.name : 'adjunto';
    const contentType =
      typeof req.query.contentType === 'string' ? req.query.contentType : 'application/octet-stream';
    const sourceMessageId =
      typeof req.query.sourceMessageId === 'string' ? req.query.sourceMessageId : undefined;
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
    try {
      const { buffer, contentType: ct, filename } = await downloadOutlookAttachmentContent(
        pack.ctx.accessToken,
        pack.ctx.graphTarget,
        messageId,
        { id: attachmentId, kind, name, contentType, sourceMessageId }
      );
      res.setHeader('Content-Type', ct);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${filename.replace(/"/g, '')}"`
      );
      return res.send(buffer);
    } catch (e) {
      console.error('outlook/attachment-download:', e);
      const msg = String((e as Error)?.message || 'Error al descargar adjunto.');
      const status = msg.includes('OneDrive') ? 422 : 502;
      return res.status(status).json({ error: msg });
    }
  });

  messageRouter.get('/:messageId/attachments', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const messageId = String(req.params.messageId || '').trim();
    if (!messageId) return res.status(400).json({ error: 'messageId requerido.' });
    try {
      const attachments = await listMessageAttachmentsMeta(
        pack.ctx.accessToken,
        pack.ctx.graphTarget,
        messageId
      );
      return res.json({ attachments });
    } catch (e) {
      console.error('outlook/attachments:', e);
      return res.status(502).json({ error: String((e as Error)?.message || 'Error al listar adjuntos.') });
    }
  });

  messageRouter.get('/:messageId', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const messageId = String(req.params.messageId || '').trim();
    if (!messageId) return res.status(400).json({ error: 'messageId requerido.' });
    try {
      const message = await getMessageDetail(pack.ctx.accessToken, pack.ctx.graphTarget, messageId);
      return res.json({ message });
    } catch (e) {
      console.error('outlook/message:', e);
      return res.status(502).json({ error: String((e as Error)?.message || 'Error al leer el correo.') });
    }
  });

  messageRouter.post('/:messageId/parse', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const messageId = String(req.params.messageId || '').trim();
    if (!messageId) return res.status(400).json({ error: 'messageId requerido.' });
    try {
      const { parsed } = await parseOutlookMessageToSession(
        messageId,
        pack.ctx.accessToken,
        pack.ctx.graphTarget,
        pack.auth.userId,
      );
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      const html = typeof parsed.html === 'string' ? parsed.html : '';
      const segundaInstancia = parseSegundaInstanciaFromEmail(
        String(parsed.subject || ''),
        text,
        html
      );
      return res.json({ ...parsed, segundaInstancia });
    } catch (e) {
      console.error('outlook/parse:', e);
      return res.status(502).json({ error: String((e as Error)?.message || 'Error al procesar el correo.') });
    }
  });

  messageRouter.post('/:messageId/classify', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;

    const messageId = String(req.params.messageId || '').trim();
    if (!messageId) return res.status(400).json({ error: 'messageId requerido.' });

    const body = (req.body ?? {}) as { parseSessionId?: string };
    const existingSessionId =
      typeof body.parseSessionId === 'string' ? body.parseSessionId.trim() : '';

    const run = async () =>
      classifyAndEnqueueOutlookMessage({
        admin: pack.auth.admin,
        accessToken: pack.ctx.accessToken,
        graphTarget: pack.ctx.graphTarget,
        courtId: pack.ctx.courtId,
        userId: pack.auth.userId,
        messageId,
        parseSessionId: existingSessionId || undefined,
      });

    try {
      const result = await Promise.race([
        run(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT_CLASSIFY')), CLASSIFY_ENDPOINT_TIMEOUT_MS)
        ),
      ]);
      if (result.usage) {
        console.info(
          `[outlook/classify] tokens in=${result.usage.input_tokens} out=${result.usage.output_tokens} pdf=${result.usage.with_pdf}`
        );
      }
      return res.json(result);
    } catch (e) {
      const msg = String((e as Error)?.message || '');
      if (msg === 'TIMEOUT_CLASSIFY') {
        return res.status(504).json({
          error:
            'El análisis tardó demasiado. Espere un momento e intente de nuevo, o use «Analizar bandeja» para procesar en segundo plano.',
        });
      }
      console.error('outlook/classify:', e);
      if (msg.includes('no conectado')) return res.status(409).json({ error: msg });
      return res.status(502).json({ error: msg || 'Error al clasificar el correo.' });
    }
  });

  app.use('/api/outlook/messages', messageRouter);

  app.post('/api/outlook/inbox/scan', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;

    const body = (req.body ?? {}) as { top?: number; folder?: string };
    const top = typeof body.top === 'number' ? body.top : parseInt(String(body.top || '20'), 10);
    const folder = parseOutlookFolderKey(typeof body.folder === 'string' ? body.folder : 'inbox');

    const run = async () =>
      scanInboxIntoReviewQueue({
        admin: pack.auth.admin,
        accessToken: pack.ctx.accessToken,
        graphTarget: pack.ctx.graphTarget,
        courtId: pack.ctx.courtId,
        userId: pack.auth.userId,
        folder,
        top: Number.isNaN(top) ? 20 : top,
      });

    try {
      const summary = await Promise.race([
        run(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT_SCAN')), INBOX_SCAN_TIMEOUT_MS)
        ),
      ]);
      return res.json(summary);
    } catch (e) {
      const msg = String((e as Error)?.message || '');
      if (msg === 'TIMEOUT_SCAN') {
        return res.status(504).json({
          error: 'El escaneo de la bandeja tardó demasiado. Reduzca la cantidad de correos o intente más tarde.',
        });
      }
      console.error('outlook/inbox/scan:', e);
      return res.status(502).json({ error: msg || 'Error al analizar la bandeja.' });
    }
  });

  app.get('/api/outlook/reviews', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const status =
      req.query.status === 'rejected' || req.query.status === 'ingested'
        ? req.query.status
        : 'pending';
    try {
      const reviews = await listOutlookMessageReviews(pack.auth.admin, pack.ctx.courtId, status);
      return res.json({ reviews });
    } catch (e) {
      console.error('outlook/reviews:', e);
      return res.status(502).json({ error: String((e as Error).message || 'Error al listar pendientes.') });
    }
  });

  app.get('/api/outlook/reviews/:reviewId', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const reviewId = String(req.params.reviewId || '').trim();
    if (!reviewId) return res.status(400).json({ error: 'reviewId requerido.' });
    try {
      const review = await getOutlookMessageReview(pack.auth.admin, pack.ctx.courtId, reviewId);
      if (!review) return res.status(404).json({ error: 'Pendiente no encontrado.' });
      return res.json({ review });
    } catch (e) {
      console.error('outlook/review:', e);
      return res.status(502).json({ error: String((e as Error).message || 'Error al consultar.') });
    }
  });

  app.post('/api/outlook/reviews/:reviewId/approve', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const reviewId = String(req.params.reviewId || '').trim();
    const body = (req.body ?? {}) as { caseId?: string };
    const caseId = typeof body.caseId === 'string' ? body.caseId.trim() : '';
    if (!reviewId) return res.status(400).json({ error: 'reviewId requerido.' });
    try {
      const review = await getOutlookMessageReview(pack.auth.admin, pack.ctx.courtId, reviewId);
      if (!review) return res.status(404).json({ error: 'Pendiente no encontrado.' });
      const cls = review.classification as ClassifyJudicialEmailResult;
      if (cls.vinculo_expediente === 'no_encontrado') {
        const ref = cls.referencia_proceso || cls.radicado_referencia || '';
        return res.status(400).json({
          error: ref
            ? `No hay expediente en Tutelia para la referencia «${ref}». Cree o localice la tutela antes de ingresar este correo.`
            : 'No se encontró expediente vinculado. No puede aprobar el ingreso hasta asociar una tutela existente.',
        });
      }
      const targetCaseId =
        caseId || review.proposed_case_id || cls.expediente_vinculado_id || '';
      if (!targetCaseId) {
        const msg = requiereVinculoExpediente(cls.tipo)
          ? 'Seleccione el expediente de tutela al que ingresar el correo.'
          : 'Seleccione el expediente al que ingresar el correo.';
        return res.status(400).json({ error: msg });
      }
      if (cls.vinculo_expediente === 'ambiguo' && !caseId) {
        return res.status(400).json({
          error: 'Hay varios expedientes posibles. Elija explícitamente el expediente correcto.',
        });
      }
      const ingest = await ingestOutlookReviewToCase({
        admin: pack.auth.admin,
        accessToken: pack.ctx.accessToken,
        graphTarget: pack.ctx.graphTarget,
        courtId: pack.ctx.courtId,
        userId: pack.auth.userId,
        review,
        caseId: targetCaseId,
      });
      return res.json({ ok: true, caseId: targetCaseId, ingest });
    } catch (e) {
      console.error('outlook/review/approve:', e);
      const msg = String((e as Error).message || 'Error al ingresar al expediente.');
      return res.status(502).json({ error: msg });
    }
  });

  app.post('/api/outlook/reviews/:reviewId/reject', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const reviewId = String(req.params.reviewId || '').trim();
    const body = (req.body ?? {}) as { reason?: string };
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (!reviewId) return res.status(400).json({ error: 'reviewId requerido.' });
    try {
      const review = await getOutlookMessageReview(pack.auth.admin, pack.ctx.courtId, reviewId);
      if (!review) return res.status(404).json({ error: 'Pendiente no encontrado.' });
      if (review.status !== 'pending') {
        return res.status(409).json({ error: 'Este correo ya fue revisado.' });
      }
      const now = new Date().toISOString();
      const { error } = await pack.auth.admin
        .from('outlook_message_reviews')
        .update({
          status: 'rejected',
          reject_reason: reason || null,
          reviewed_by: pack.auth.userId,
          reviewed_at: now,
          updated_at: now,
        })
        .eq('id', reviewId)
        .eq('court_id', pack.ctx.courtId);
      if (error) throw new Error(error.message);
      return res.json({ ok: true });
    } catch (e) {
      console.error('outlook/review/reject:', e);
      return res.status(502).json({ error: String((e as Error).message || 'Error al descartar.') });
    }
  });

  app.post('/api/outlook/send', async (req, res) => {
    const pack = await resolveCtxOrRespond(req, res, getSupabaseAdmin);
    if (!pack) return;
    const body = req.body as {
      subject?: string;
      bodyHtml?: string;
      to?: string[];
      cc?: string[];
      attachments?: Array<{ name?: string; contentType?: string; contentBytesBase64?: string }>;
    };
    const subject = String(body.subject || '').trim();
    const bodyHtml = String(body.bodyHtml || '').trim();
    const to = Array.isArray(body.to) ? body.to.map(String) : [];
    const cc = Array.isArray(body.cc) ? body.cc.map(String) : [];
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.map((a) => ({
          name: String(a.name || '').trim(),
          contentType: String(a.contentType || 'application/octet-stream').trim(),
          contentBytesBase64: String(a.contentBytesBase64 || '').trim(),
        }))
      : [];
    if (!subject || !bodyHtml) return res.status(400).json({ error: 'Asunto y cuerpo son obligatorios.' });
    try {
      await sendMail(pack.ctx.accessToken, pack.ctx.graphTarget, { subject, bodyHtml, to, cc, attachments });
      return res.json({ ok: true });
    } catch (e) {
      console.error('outlook/send:', e);
      return res.status(502).json({ error: String((e as Error)?.message || 'Error al enviar.') });
    }
  });
}
