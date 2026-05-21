export const OUTLOOK_GRAPH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
] as const;

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
