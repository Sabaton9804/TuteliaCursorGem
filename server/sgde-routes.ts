import type { Express, Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuthenticatedCaller } from './outlook-auth';
import { sgdePlatformState } from './sgde-integration';
import { getLoggedInSgdeClientForUser, invalidateSgdeSession } from './sgde-session-cache';
import {
  deleteUserSgdeCredentials,
  getUserSgdeCredentialsMeta,
  saveUserSgdeCredentials,
} from './sgde-credentials';
import { importExpedienteFromSgde } from './sgde-import';
import { migrateSgdeOriginToCase, preflightSgdeOriginExpediente } from './sgde-migrate';
import { publishSegundaTrasladoToSgdeImpugnacion } from './sgde-segunda-impugnacion';
import { createExpedienteInSgde } from './sgde-create-expediente';
import { syncDocumentsWithSgde } from './sgde-sync-documents';
import { repairStorageFromSgde, ensureCaseDocumentViewUrl } from './sgde-repair-storage';
import { signCaseDocumentInSgde } from './sgde-sign-document';
import { parseSegundaInstanciaFromEmail } from './sgde-segunda-instancia-parse';
import { SgdeClient, getDefaultSgdeBaseUrl } from './sgde-client';
import { formatSgdeConnectionError } from './sgde-tls';

const SGDE_API_BUILD = '2026-05-20-per-user-credentials-v1';

async function sgdeClientForRequest(
  req: Request,
  getSupabaseAdmin: () => SupabaseClient
) {
  const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
  if (auth.ok === false) {
    return { ok: false as const, status: auth.status, message: auth.message };
  }
  const platform = sgdePlatformState();
  if (!platform.available) {
    return {
      ok: false as const,
      status: 503,
      message: platform.message || 'SGDE no disponible.',
      code: 'PLATFORM_UNAVAILABLE',
    };
  }
  const logged = await getLoggedInSgdeClientForUser(auth.admin, auth.userId);
  if ('error' in logged) {
    const status = logged.code === 'USER_NOT_CONFIGURED' ? 403 : 502;
    return { ok: false as const, status, message: logged.error, code: logged.code };
  }
  return {
    ok: true as const,
    auth,
    client: logged.client,
    portalBaseUrl: logged.portalBaseUrl,
  };
}

export function registerSgdeRoutes(app: Express, getSupabaseAdmin: () => SupabaseClient): void {
  console.info(
    `[tutelia] SGDE API (${SGDE_API_BUILD}): status, credentials, case-tree, link, preflight-origin, preview-node, migrate-origin-to-case, import-expediente, create-expediente, sync-documents, repair-storage, document-view-url, sign-document`
  );

  app.get('/api/sgde/status', async (req, res) => {
    const platform = sgdePlatformState();
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) {
      return res.json({
        enabled: platform.available,
        configured: false,
        portalBaseUrl: platform.portalBaseUrl,
        encryptionReady: platform.encryptionReady,
        globallyDisabled: platform.globallyDisabled,
        userConfigured: false,
        message: auth.message,
      });
    }
    const meta = await getUserSgdeCredentialsMeta(auth.admin, auth.userId);
    return res.json({
      enabled: platform.available,
      configured: meta.configured,
      userConfigured: meta.configured,
      usernameMasked: meta.usernameMasked,
      credentialsUpdatedAt: meta.updatedAt,
      portalBaseUrl: platform.portalBaseUrl,
      encryptionReady: platform.encryptionReady,
      globallyDisabled: platform.globallyDisabled,
      message: !platform.available
        ? platform.message
        : !meta.configured
          ? 'Configure su usuario y contraseña SGDE en Ajustes.'
          : undefined,
    });
  });

  app.put('/api/sgde/credentials', async (req, res) => {
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });

    const platform = sgdePlatformState();
    if (!platform.encryptionReady) {
      return res.status(503).json({
        error:
          'El servidor no puede almacenar contraseñas SGDE (falta SGDE_CREDENTIALS_KEY). Contacte al administrador de Tutelia.',
      });
    }

    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña SGDE son obligatorios.' });
    }

    const probe = new SgdeClient(getDefaultSgdeBaseUrl());
    probe.setCredentials(username, password);
    const loginRes = await probe.login();
    if (loginRes.ok === false) {
      return res.status(400).json({
        error: formatSgdeConnectionError(`No se pudo validar el acceso a SGDE: ${loginRes.message}`),
      });
    }

    const saved = await saveUserSgdeCredentials(auth.admin, auth.userId, username, password);
    if (saved.error) {
      return res.status(500).json({ error: saved.error });
    }
    invalidateSgdeSession(auth.userId);

    const meta = await getUserSgdeCredentialsMeta(auth.admin, auth.userId);
    return res.json({
      ok: true,
      usernameMasked: meta.usernameMasked,
      credentialsUpdatedAt: meta.updatedAt,
    });
  });

  app.delete('/api/sgde/credentials', async (req, res) => {
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });
    await deleteUserSgdeCredentials(auth.admin, auth.userId);
    invalidateSgdeSession(auth.userId);
    return res.json({ ok: true });
  });

  app.post('/api/sgde/preflight-origin', async (req, res) => {
    const body = (req.body ?? {}) as {
      originRadicado?: string;
      sgdeNodeIdHint?: string;
      emailDigest?: string;
    };
    const originRadicado = String(body.originRadicado || '').trim();
    const sgdeNodeIdHint = String(body.sgdeNodeIdHint || '').trim() || null;
    const emailDigest = String(body.emailDigest || '').trim() || null;
    if (!originRadicado) {
      return res.status(400).json({ error: 'originRadicado es requerido (23 dígitos).' });
    }

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({
        ok: false,
        status: 'error_login',
        error: sess.message,
        code: sess.code,
      });
    }

    try {
      const result = await preflightSgdeOriginExpediente(sess.client, originRadicado, {
        sgdeNodeIdHint,
        emailDigest,
      });
      return res.json({ ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/preflight-origin:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/preview-node', async (req, res) => {
    const nodeId = String((req.body as { nodeId?: string })?.nodeId || '').trim();
    if (!nodeId || !/^[0-9a-f-]{36}$/i.test(nodeId)) {
      return res.status(400).json({ error: 'nodeId (UUID) es requerido.' });
    }

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const t0 = Date.now();
    try {
      const downloaded = await sess.client.downloadNodeContent(nodeId);
      if (!downloaded?.buffer?.length) {
        return res.status(404).json({ error: 'No se pudo descargar el documento desde SGDE.' });
      }
      const ct = downloaded.contentType || 'application/pdf';
      res.setHeader('Content-Type', ct);
      res.setHeader('Content-Length', String(downloaded.buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.setHeader('X-Sgde-Node-Id', nodeId);
      res.setHeader('X-Sgde-Preview-Ms', String(Date.now() - t0));
      return res.send(downloaded.buffer);
    } catch (e) {
      console.error('sgde/preview-node:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/publish-segunda-impugnacion', async (req, res) => {
    const body = (req.body ?? {}) as {
      caseId?: string;
      originRadicado?: string;
      sgdeRootId?: string;
    };
    const caseId = String(body.caseId || '').trim();
    const originRadicado = String(body.originRadicado || '').replace(/\D/g, '');
    const sgdeRootId = String(body.sgdeRootId || '').trim();
    if (!caseId) return res.status(400).json({ error: 'caseId es requerido.' });
    if (originRadicado.length !== 23) {
      return res.status(400).json({ error: 'originRadicado debe tener 23 dígitos (CUI de origen en SGDE).' });
    }

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const { data: caseRow, error: caseErr } = await sess.auth.admin
      .from('cases')
      .select('id, court_id')
      .eq('id', caseId)
      .maybeSingle();
    if (caseErr || !caseRow?.id) {
      return res.status(404).json({ error: 'Expediente no encontrado.' });
    }

    const { data: prof } = await sess.auth.admin
      .from('profiles')
      .select('court_id')
      .eq('id', sess.auth.userId)
      .maybeSingle();
    if (!prof?.court_id || String(prof.court_id) !== String(caseRow.court_id)) {
      return res.status(403).json({ error: 'No autorizado para este expediente.' });
    }

    try {
      const result = await publishSegundaTrasladoToSgdeImpugnacion({
        client: sess.client,
        admin: sess.auth.admin,
        caseId,
        sgdeRootId,
        originRadicado23: originRadicado,
      });
      return res.json({ ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/publish-segunda-impugnacion:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/import-expediente', async (req, res) => {
    const body = (req.body ?? {}) as {
      caseType?: string;
      radicado?: string;
      originRadicado?: string;
      sgdeNodeIdHint?: string;
      originCourt?: string;
      appellant?: string;
      originRuling?: string;
      forceMigrate?: boolean;
    };

    const caseType = String(body.caseType || '').trim();
    if (caseType !== 'tutela_primera' && caseType !== 'tutela_segunda') {
      return res.status(400).json({ error: 'caseType debe ser tutela_primera o tutela_segunda.' });
    }

    const radicado = String(body.radicado || body.originRadicado || '').trim();
    if (!radicado) {
      return res.status(400).json({ error: 'radicado es requerido (23 dígitos).' });
    }

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const { data: prof, error: profErr } = await sess.auth.admin
      .from('profiles')
      .select('court_id, name')
      .eq('id', sess.auth.userId)
      .maybeSingle();
    if (profErr || !prof?.court_id) {
      return res.status(403).json({ error: 'Perfil sin despacho asignado.' });
    }

    const appellantRaw = String(body.appellant || '').trim();
    const rulingRaw = String(body.originRuling || '').trim();

    try {
      const result = await importExpedienteFromSgde({
        client: sess.client,
        admin: sess.auth.admin,
        userId: sess.auth.userId,
        userName: String(prof.name || '').trim() || undefined,
        courtId: String(prof.court_id),
        caseType,
        radicadoRaw: radicado,
        sgdeNodeIdHint: String(body.sgdeNodeIdHint || '').trim() || null,
        originCourt: String(body.originCourt || '').trim() || undefined,
        appellant:
          appellantRaw === 'accionante' || appellantRaw === 'accionado'
            ? appellantRaw
            : undefined,
        originRuling:
          rulingRaw === 'concedio' || rulingRaw === 'nego' ? rulingRaw : undefined,
        forceMigrate: body.forceMigrate === true,
      });
      return res.json({ ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/import-expediente:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/migrate-origin-to-case', async (req, res) => {
    const body = (req.body ?? {}) as {
      caseId?: string;
      originRadicado?: string;
      sgdeRootId?: string;
      sgdeNodeIdHint?: string;
      notebookCode?: string;
      maxFiles?: number;
      force?: boolean;
    };
    const caseId = String(body.caseId || '').trim();
    const originRadicado = String(body.originRadicado || '').trim();
    const notebookCode = String(body.notebookCode || 'SI_C01_PRINCIPAL').trim();

    if (!caseId) return res.status(400).json({ error: 'caseId es requerido.' });
    if (!originRadicado) return res.status(400).json({ error: 'originRadicado es requerido.' });

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const { data: caseRow, error: caseErr } = await sess.auth.admin
      .from('cases')
      .select('id, court_id')
      .eq('id', caseId)
      .maybeSingle();
    if (caseErr || !caseRow?.id) {
      return res.status(404).json({ error: 'Expediente no encontrado.' });
    }

    const { data: prof } = await sess.auth.admin
      .from('profiles')
      .select('court_id')
      .eq('id', sess.auth.userId)
      .maybeSingle();
    if (!prof?.court_id || String(prof.court_id) !== String(caseRow.court_id)) {
      return res.status(403).json({ error: 'No autorizado para este expediente.' });
    }

    try {
      const result = await migrateSgdeOriginToCase({
        client: sess.client,
        admin: sess.auth.admin,
        caseId,
        originRadicado,
        sgdeRootId: body.sgdeRootId,
        sgdeNodeIdHint: body.sgdeNodeIdHint,
        notebookCode,
        maxFiles: typeof body.maxFiles === 'number' ? body.maxFiles : undefined,
        force: body.force === true,
      });
      return res.json({ ok: true, ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/migrate-origin-to-case:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/parse-segunda-email', async (req, res) => {
    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.message });

    const body = (req.body ?? {}) as { subject?: string; text?: string; html?: string };
    const segundaInstancia = parseSegundaInstanciaFromEmail(
      String(body.subject || ''),
      String(body.text || ''),
      typeof body.html === 'string' ? body.html : undefined
    );
    return res.json({ segundaInstancia });
  });

  app.post('/api/sgde/create-expediente', async (req, res) => {
    const body = (req.body ?? {}) as {
      caseId?: string;
      uploadDocuments?: boolean;
    };
    const caseId = String(body.caseId || '').trim();
    if (!caseId) return res.status(400).json({ error: 'caseId es requerido.' });

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const { data: caseRow, error: caseErr } = await sess.auth.admin
      .from('cases')
      .select('id, court_id, sgde_sync_status')
      .eq('id', caseId)
      .maybeSingle();
    if (caseErr || !caseRow?.id) {
      return res.status(404).json({ error: 'Expediente no encontrado.' });
    }

    const { data: prof } = await sess.auth.admin
      .from('profiles')
      .select('court_id')
      .eq('id', sess.auth.userId)
      .maybeSingle();
    if (!prof?.court_id || String(prof.court_id) !== String(caseRow.court_id)) {
      return res.status(403).json({ error: 'No autorizado para este expediente.' });
    }

    const syncNow = new Date().toISOString();
    await sess.auth.admin
      .from('cases')
      .update({ sgde_sync_status: 'syncing', updated_at: syncNow })
      .eq('id', caseId);

    try {
      const result = await createExpedienteInSgde({
        client: sess.client,
        admin: sess.auth.admin,
        caseId,
        uploadDocuments: body.uploadDocuments !== false,
      });

      if (!result.ok && result.uploadFailed > 0) {
        await sess.auth.admin
          .from('cases')
          .update({ sgde_sync_status: 'error', updated_at: new Date().toISOString() })
          .eq('id', caseId);
      }

      return res.json({ ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/create-expediente:', e);
      await sess.auth.admin
        .from('cases')
        .update({ sgde_sync_status: 'error', updated_at: new Date().toISOString() })
        .eq('id', caseId);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/sync-documents', async (req, res) => {
    const body = (req.body ?? {}) as { caseId?: string; uploadMissing?: boolean };
    const caseId = String(body.caseId || '').trim();
    if (!caseId) return res.status(400).json({ error: 'caseId es requerido.' });

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const { data: caseRow, error: caseErr } = await sess.auth.admin
      .from('cases')
      .select('id, court_id')
      .eq('id', caseId)
      .maybeSingle();
    if (caseErr || !caseRow?.id) {
      return res.status(404).json({ error: 'Expediente no encontrado.' });
    }

    const { data: prof } = await sess.auth.admin
      .from('profiles')
      .select('court_id')
      .eq('id', sess.auth.userId)
      .maybeSingle();
    if (!prof?.court_id || String(prof.court_id) !== String(caseRow.court_id)) {
      return res.status(403).json({ error: 'No autorizado para este expediente.' });
    }

    const syncNow = new Date().toISOString();
    await sess.auth.admin
      .from('cases')
      .update({ sgde_sync_status: 'syncing', updated_at: syncNow })
      .eq('id', caseId);

    try {
      const result = await syncDocumentsWithSgde({
        client: sess.client,
        admin: sess.auth.admin,
        caseId,
        uploadMissing: body.uploadMissing !== false,
      });
      return res.json({ ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/sync-documents:', e);
      await sess.auth.admin
        .from('cases')
        .update({ sgde_sync_status: 'error', updated_at: new Date().toISOString() })
        .eq('id', caseId);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/repair-storage', async (req, res) => {
    const body = (req.body ?? {}) as { caseId?: string; importSgdeOnly?: boolean };
    const caseId = String(body.caseId || '').trim();
    if (!caseId) return res.status(400).json({ error: 'caseId es requerido.' });

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const { data: caseRow, error: caseErr } = await sess.auth.admin
      .from('cases')
      .select('id, court_id, radicado, sgde_id, case_type')
      .eq('id', caseId)
      .maybeSingle();
    if (caseErr || !caseRow?.id) {
      return res.status(404).json({ error: 'Expediente no encontrado.' });
    }

    const { data: prof } = await sess.auth.admin
      .from('profiles')
      .select('court_id')
      .eq('id', sess.auth.userId)
      .maybeSingle();
    if (!prof?.court_id || String(prof.court_id) !== String(caseRow.court_id)) {
      return res.status(403).json({ error: 'No autorizado para este expediente.' });
    }

    const radicado23 = String(caseRow.radicado || '').replace(/\D/g, '').slice(0, 23);
    if (radicado23.length !== 23) {
      return res.status(400).json({ error: 'Radicado inválido (23 dígitos).' });
    }

    let sgdeRootId = String(caseRow.sgde_id || '').trim();
    if (!sgdeRootId) {
      sgdeRootId = (await sess.client.buscarExpedienteNodeId(radicado23)) || '';
    }
    if (!sgdeRootId) {
      return res.status(400).json({
        error: 'El expediente no está vinculado a SGDE. Use «Vincular» o importe desde SGDE primero.',
      });
    }

    try {
      const result = await repairStorageFromSgde({
        client: sess.client,
        admin: sess.auth.admin,
        caseId,
        sgdeRootId,
        caseType: caseRow.case_type ? String(caseRow.case_type) : null,
        originRadicado: radicado23,
        importSgdeOnly: body.importSgdeOnly !== false,
      });
      const now = new Date().toISOString();
      await sess.auth.admin
        .from('cases')
        .update({
          sgde_id: sgdeRootId,
          sgde_linked_at: now,
          sgde_sync_status: result.ok ? 'linked' : 'error',
          updated_at: now,
        })
        .eq('id', caseId);
      return res.json({ ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/repair-storage:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/document-view-url', async (req, res) => {
    const body = (req.body ?? {}) as { caseId?: string; documentId?: string };
    const caseId = String(body.caseId || '').trim();
    const documentId = String(body.documentId || '').trim();
    if (!caseId) return res.status(400).json({ error: 'caseId es requerido.' });
    if (!documentId) return res.status(400).json({ error: 'documentId es requerido.' });

    const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (auth.ok === false) {
      return res.status(auth.status).json({ error: auth.message });
    }

    const { data: caseRow, error: caseErr } = await auth.admin
      .from('cases')
      .select('id, court_id')
      .eq('id', caseId)
      .maybeSingle();
    if (caseErr || !caseRow?.id) {
      return res.status(404).json({ error: 'Expediente no encontrado.' });
    }

    const { data: prof } = await auth.admin
      .from('profiles')
      .select('court_id')
      .eq('id', auth.userId)
      .maybeSingle();
    if (!prof?.court_id || String(prof.court_id) !== String(caseRow.court_id)) {
      return res.status(403).json({ error: 'No autorizado para este expediente.' });
    }

    let sgdeClient: import('./sgde-client').SgdeClient | null = null;
    const platform = sgdePlatformState();
    if (platform.available) {
      const logged = await getLoggedInSgdeClientForUser(auth.admin, auth.userId);
      if (!('error' in logged)) sgdeClient = logged.client;
    }

    try {
      const result = await ensureCaseDocumentViewUrl({
        admin: auth.admin,
        client: sgdeClient,
        caseId,
        documentId,
      });
      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }
      const portalBaseUrl = platform.portalBaseUrl;
      return res.json({
        signedUrl: result.signedUrl,
        storagePath: result.storagePath,
        repaired: result.repaired,
        portalBaseUrl,
      });
    } catch (e) {
      console.error('sgde/document-view-url:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });

  app.post('/api/sgde/sign-document', async (req, res) => {
    const body = (req.body ?? {}) as {
      caseId?: string;
      documentId?: string;
      username?: string;
      password?: string;
      refreshLocal?: boolean;
    };
    const caseId = String(body.caseId || '').trim();
    const documentId = String(body.documentId || '').trim();
    if (!caseId) return res.status(400).json({ error: 'caseId es requerido.' });
    if (!documentId) return res.status(400).json({ error: 'documentId es requerido.' });

    const sess = await sgdeClientForRequest(req, getSupabaseAdmin);
    if (sess.ok === false) {
      return res.status(sess.status).json({ error: sess.message, code: sess.code });
    }

    const { data: caseRow, error: caseErr } = await sess.auth.admin
      .from('cases')
      .select('id, court_id')
      .eq('id', caseId)
      .maybeSingle();
    if (caseErr || !caseRow?.id) {
      return res.status(404).json({ error: 'Expediente no encontrado.' });
    }

    const { data: prof } = await sess.auth.admin
      .from('profiles')
      .select('court_id')
      .eq('id', sess.auth.userId)
      .maybeSingle();
    if (!prof?.court_id || String(prof.court_id) !== String(caseRow.court_id)) {
      return res.status(403).json({ error: 'No autorizado para este expediente.' });
    }

    try {
      const result = await signCaseDocumentInSgde({
        client: sess.client,
        admin: sess.auth.admin,
        userId: sess.auth.userId,
        caseId,
        documentId,
        username: body.username,
        password: body.password,
        refreshLocal: body.refreshLocal !== false,
      });
      if (!result.ok) {
        return res.status(400).json({ ...result, error: result.message });
      }
      return res.json({ ...result, portalBaseUrl: sess.portalBaseUrl });
    } catch (e) {
      console.error('sgde/sign-document:', e);
      return res.status(500).json({ error: String((e as Error)?.message || e) });
    }
  });
}
