import axios from 'axios';
import https from 'node:https';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getOutlookCredentialEnv,
  getOutlookRedirectUri,
  OUTLOOK_GRAPH_SCOPES,
} from './outlook-config';
import { formatMicrosoftOAuthError, isOutlookTlsInsecureEnv } from './outlook-ms-error';
import {
  graphThrottleUserMessage,
  isGraphThrottledError,
  runQueuedGraphFetch,
  runQueuedGraphRequest,
} from './outlook-graph-queue';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export type OutlookConnectionRow = {
  user_id: string;
  mailbox_email: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  scopes: string | null;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

function authorizeEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
}

export function buildOutlookAuthorizeUrl(userId: string, state: string): string {
  const { clientId, tenantId } = getOutlookCredentialEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getOutlookRedirectUri(),
    response_mode: 'query',
    scope: OUTLOOK_GRAPH_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  return `${authorizeEndpoint(tenantId)}?${params.toString()}`;
}

function microsoftAxiosConfig() {
  const insecure = isOutlookTlsInsecureEnv();
  if (insecure) {
    console.warn('[tutelia] Outlook: TLS inseguro activo hacia login.microsoftonline.com (solo diagnóstico).');
  }
  return {
    timeout: 30000,
    ...(insecure ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {}),
  };
}

async function exchangeToken(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret, tenantId } = getOutlookCredentialEnv();
  try {
    const { data } = await axios.post<TokenResponse>(
      tokenEndpoint(tenantId),
      new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        ...microsoftAxiosConfig(),
      }
    );
    return data;
  } catch (e) {
    throw new Error(formatMicrosoftOAuthError(e));
  }
}

export async function exchangeOutlookAuthCode(code: string): Promise<TokenResponse> {
  return exchangeToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getOutlookRedirectUri(),
  });
}

async function refreshOutlookAccessToken(refreshToken: string): Promise<TokenResponse> {
  return exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: OUTLOOK_GRAPH_SCOPES.join(' '),
  });
}

export async function getOutlookConnection(
  admin: SupabaseClient,
  userId: string
): Promise<OutlookConnectionRow | null> {
  const { data, error } = await admin.from('outlook_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data as OutlookConnectionRow | null;
}

async function persistTokens(
  admin: SupabaseClient,
  userId: string,
  mailboxEmail: string,
  tokens: TokenResponse,
  existingRefresh?: string
): Promise<void> {
  const refresh = tokens.refresh_token || existingRefresh;
  if (!refresh) throw new Error('Microsoft no devolvió refresh_token. Revoque el acceso y vuelva a conectar.');
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error } = await admin.from('outlook_connections').upsert(
    {
      user_id: userId,
      mailbox_email: mailboxEmail,
      access_token: tokens.access_token,
      refresh_token: refresh,
      token_expires_at: expiresAt,
      scopes: tokens.scope ?? OUTLOOK_GRAPH_SCOPES.join(' '),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

export async function saveOutlookConnectionFromAuthCode(
  admin: SupabaseClient,
  userId: string,
  code: string
): Promise<{ mailboxEmail: string }> {
  const tokens = await exchangeOutlookAuthCode(code);
  const profile = await graphRequest<{ mail?: string; userPrincipalName?: string }>(
    tokens.access_token,
    '/me?$select=mail,userPrincipalName'
  );
  const mailboxEmail = (profile.mail || profile.userPrincipalName || '').trim();
  if (!mailboxEmail) throw new Error('No se pudo determinar el correo del buzón.');
  await persistTokens(admin, userId, mailboxEmail, tokens);
  return { mailboxEmail };
}

export async function getValidOutlookAccessToken(
  admin: SupabaseClient,
  userId: string
): Promise<{ accessToken: string; mailboxEmail: string }> {
  const row = await getOutlookConnection(admin, userId);
  if (!row) throw new Error('Outlook no conectado para este usuario.');

  const expiresMs = new Date(row.token_expires_at).getTime();
  if (expiresMs > Date.now() + 60_000) {
    return { accessToken: row.access_token, mailboxEmail: row.mailbox_email };
  }

  const tokens = await refreshOutlookAccessToken(row.refresh_token);
  await persistTokens(admin, userId, row.mailbox_email, tokens, row.refresh_token);
  return { accessToken: tokens.access_token, mailboxEmail: row.mailbox_email };
}

export async function disconnectOutlook(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from('outlook_connections').delete().eq('user_id', userId);
  if (error) throw error;
}

export { graphThrottleUserMessage, isGraphThrottledError } from './outlook-graph-queue';

async function graphRequestOnce<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function graphRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  try {
    return await runQueuedGraphRequest(() => graphRequestOnce<T>(accessToken, path, init));
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (isGraphThrottledError(msg)) {
      throw new Error(graphThrottleUserMessage());
    }
    throw e;
  }
}

/** Descarga binaria (adjuntos $value) con la misma cola anti-throttling. */
export async function graphFetch(accessToken: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await runQueuedGraphFetch(accessToken, url, init);
  if (!res.ok && res.status === 429) {
    throw new Error(graphThrottleUserMessage());
  }
  return res;
}

export type GraphMessageListItem = {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
};

export const OUTLOOK_FOLDER_KEYS = ['inbox', 'drafts', 'sentitems', 'deleteditems', 'junkemail'] as const;
export type OutlookFolderKey = (typeof OUTLOOK_FOLDER_KEYS)[number];

export const OUTLOOK_FOLDER_LABELS: Record<OutlookFolderKey, string> = {
  inbox: 'Bandeja de entrada',
  drafts: 'Borradores',
  sentitems: 'Enviados',
  deleteditems: 'Papelera',
  junkemail: 'No deseado',
};

export type OutlookFolderStat = {
  id: OutlookFolderKey;
  label: string;
  total: number;
  unread: number;
};

export function parseOutlookFolderKey(raw: string | undefined): OutlookFolderKey {
  const key = String(raw || 'inbox').toLowerCase() as OutlookFolderKey;
  return OUTLOOK_FOLDER_KEYS.includes(key) ? key : 'inbox';
}

export async function getMailFolderOverview(accessToken: string): Promise<OutlookFolderStat[]> {
  const results: OutlookFolderStat[] = [];
  for (const id of OUTLOOK_FOLDER_KEYS) {
    try {
      const data = await graphRequest<{ totalItemCount?: number; unreadItemCount?: number }>(
        accessToken,
        `/me/mailFolders/${id}?$select=totalItemCount,unreadItemCount`
      );
      results.push({
        id,
        label: OUTLOOK_FOLDER_LABELS[id],
        total: data.totalItemCount ?? 0,
        unread: data.unreadItemCount ?? 0,
      });
    } catch (e) {
      console.warn(`[outlook] carpeta ${id}:`, (e as Error)?.message || e);
      results.push({ id, label: OUTLOOK_FOLDER_LABELS[id], total: 0, unread: 0 });
    }
  }
  return results;
}

export async function listFolderMessages(
  accessToken: string,
  folder: OutlookFolderKey = 'inbox',
  opts?: { top?: number; skip?: number; search?: string }
): Promise<GraphMessageListItem[]> {
  const top = Math.min(Math.max(opts?.top ?? 30, 1), 50);
  const orderBy =
    folder === 'drafts'
      ? 'lastModifiedDateTime desc'
      : folder === 'sentitems'
        ? 'sentDateTime desc'
        : 'receivedDateTime desc';
  const params = new URLSearchParams({
    $top: String(top),
    $orderby: orderBy,
    $select: 'id,subject,from,receivedDateTime,sentDateTime,lastModifiedDateTime,isRead,hasAttachments',
  });
  if (opts?.skip) params.set('$skip', String(opts.skip));
  if (opts?.search?.trim()) params.set('$search', `"${opts.search.trim().replace(/"/g, '')}"`);
  const data = await graphRequest<{ value?: GraphMessageListItem[] }>(
    accessToken,
    `/me/mailFolders/${folder}/messages?${params}`
  );
  return data.value ?? [];
}

/** @deprecated Use listFolderMessages(accessToken, 'inbox', opts) */
export async function listInboxMessages(
  accessToken: string,
  opts?: { top?: number; skip?: number; search?: string }
): Promise<GraphMessageListItem[]> {
  return listFolderMessages(accessToken, 'inbox', opts);
}

export async function getMessageDetail(accessToken: string, messageId: string) {
  return graphRequest<Record<string, unknown>>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,isRead`
  );
}

export async function getMessageMime(accessToken: string, messageId: string): Promise<Buffer> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/$value`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`No se pudo descargar el correo (${res.status}): ${text.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function sendMail(
  accessToken: string,
  payload: {
    subject: string;
    bodyHtml: string;
    to: string[];
    cc?: string[];
  }
): Promise<void> {
  const toRecipients = payload.to.map((address) => ({ emailAddress: { address: address.trim() } })).filter((r) => r.emailAddress.address);
  if (!toRecipients.length) throw new Error('Indique al menos un destinatario.');
  const ccRecipients = (payload.cc ?? [])
    .map((address) => ({ emailAddress: { address: address.trim() } }))
    .filter((r) => r.emailAddress.address);

  await graphRequest(accessToken, '/me/sendMail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: payload.subject,
        body: { contentType: 'HTML', content: payload.bodyHtml },
        toRecipients,
        ...(ccRecipients.length ? { ccRecipients } : {}),
      },
      saveToSentItems: true,
    }),
  });
}
