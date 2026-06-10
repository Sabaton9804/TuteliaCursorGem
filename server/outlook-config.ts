/** Buzones compartidos delegados (v0.4). */
export const OUTLOOK_GRAPH_SCOPES_SHARED = [
  'Mail.Read.Shared',
  'Mail.ReadWrite.Shared',
  'Mail.Send.Shared',
] as const;

/** Buzón personal /me — compatibilidad piloto. */
export const OUTLOOK_GRAPH_SCOPES_LEGACY_ME = [
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
] as const;

export const OUTLOOK_GRAPH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  ...OUTLOOK_GRAPH_SCOPES_SHARED,
  ...OUTLOOK_GRAPH_SCOPES_LEGACY_ME,
] as const;

export function isOutlookAllowLegacyMe(): boolean {
  const v = String(process.env.OUTLOOK_ALLOW_LEGACY_ME ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export function isOutlookRequireExplicitMailbox(): boolean {
  const v = String(process.env.OUTLOOK_REQUIRE_EXPLICIT_MAILBOX ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export function outlookOAuthPrompt(): string | undefined {
  const explicit = (process.env.OUTLOOK_OAUTH_PROMPT || '').trim();
  if (explicit === 'none') return undefined;
  if (explicit) return explicit;
  if (process.env.NODE_ENV === 'production') return undefined;
  return 'consent';
}

export type OutlookIntegrationState = {
  enabled: boolean;
  configured: boolean;
  redirectUri: string;
};

function appOrigin(): string {
  const fromEnv = (process.env.APP_URL || process.env.VITE_APP_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export function getOutlookRedirectUri(): string {
  const explicit = (process.env.OUTLOOK_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  return `${appOrigin()}/api/outlook/callback`;
}

export function getOutlookCredentialEnv(): { clientId: string; clientSecret: string; tenantId: string } {
  const clientId = (
    process.env.OUTLOOK_CLIENT_ID ||
    process.env.AZURE_CLIENT_ID ||
    process.env.MICROSOFT_CLIENT_ID ||
    ''
  ).trim();
  const clientSecret = (
    process.env.OUTLOOK_CLIENT_SECRET ||
    process.env.AZURE_CLIENT_SECRET ||
    process.env.MICROSOFT_CLIENT_SECRET ||
    ''
  ).trim();
  const tenantId = (
    process.env.OUTLOOK_TENANT_ID ||
    process.env.AZURE_TENANT_ID ||
    process.env.MICROSOFT_TENANT_ID ||
    'common'
  ).trim();
  return { clientId, clientSecret, tenantId: tenantId || 'common' };
}

export function outlookIntegrationState(): OutlookIntegrationState {
  const { clientId, clientSecret } = getOutlookCredentialEnv();
  const configured = Boolean(clientId && clientSecret);
  const off =
    process.env.OUTLOOK_ENABLED === '0' ||
    process.env.OUTLOOK_ENABLED === 'false' ||
    String(process.env.OUTLOOK_ENABLED || '').toLowerCase() === 'off';
  return {
    enabled: configured && !off,
    configured,
    redirectUri: getOutlookRedirectUri(),
  };
}

export function getOutlookStateSecret(): string {
  return (
    process.env.OUTLOOK_STATE_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    'tutelia-outlook-dev-only'
  );
}
