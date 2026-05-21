/**
 * Prueba credenciales Outlook en .env sin flujo OAuth completo.
 * Código inválido → AADSTS70000 (invalid_grant) = client id/secret OK.
 * Secreto o id mal → AADSTS7000215 / 700016 (invalid_client).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local') });

const clientId = (
  process.env.OUTLOOK_CLIENT_ID ||
  process.env.AZURE_CLIENT_ID ||
  ''
).trim();
const clientSecret = (
  process.env.OUTLOOK_CLIENT_SECRET ||
  process.env.AZURE_CLIENT_SECRET ||
  ''
).trim();
const tenantId = (process.env.OUTLOOK_TENANT_ID || 'common').trim();
const redirectUri = (
  process.env.OUTLOOK_REDIRECT_URI || `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/outlook/callback`
).trim();

async function main() {
  console.log('--- Outlook / Microsoft Entra (diagnóstico) ---');
  if (!clientId || !clientSecret) {
    console.error('FALLO: OUTLOOK_CLIENT_ID o OUTLOOK_CLIENT_SECRET vacíos.');
    process.exit(1);
  }
  console.log('Client ID:', clientId.slice(0, 8) + '…');
  console.log('Tenant:', tenantId);
  console.log('Redirect URI:', redirectUri);

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: 'diagnostico-tutelia-codigo-invalido',
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let json: { error?: string; error_description?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    /* ignore */
  }

  const desc = String(json.error_description || text).toLowerCase();
  const err = String(json.error || '').toLowerCase();

  if (desc.includes('7000215') || desc.includes('invalid client secret') || err === 'invalid_client') {
    console.error('FALLO: Client secret incorrecto o expirado (revise en Azure → Certificados y secretos).');
    process.exit(1);
  }
  if (desc.includes('700016') || desc.includes('application was not found')) {
    console.error('FALLO: Client ID no encontrado en el tenant.');
    process.exit(1);
  }
  if (
    desc.includes('invalid_grant') ||
    desc.includes('70000') ||
    desc.includes('authorization code') ||
    err === 'invalid_grant'
  ) {
    console.log('OK: Microsoft aceptó client_id y client_secret (error esperado por código OAuth falso).');
    console.log('Siguiente paso: en la app → Correo → Conectar Outlook (inicio de sesión del funcionario).');
    process.exit(0);
  }

  console.log('Respuesta inesperada (HTTP', res.status + '):', text.slice(0, 400));
  process.exit(res.ok ? 0 : 2);
}

void main();
