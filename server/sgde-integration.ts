import type { SupabaseClient } from '@supabase/supabase-js';
import { SgdeClient, getDefaultSgdeBaseUrl } from './sgde-client';
import { sgdeEncryptionAvailable } from './sgde-crypto';
import { getUserSgdeCredentials } from './sgde-credentials';

/** Estado de la plataforma SGDE (sin credenciales de usuario). */
export function sgdePlatformState(): {
  available: boolean;
  encryptionReady: boolean;
  globallyDisabled: boolean;
  portalBaseUrl: string;
  message?: string;
} {
  const off =
    process.env.SGDE_ENABLED === '0' ||
    process.env.SGDE_ENABLED === 'false' ||
    String(process.env.SGDE_ENABLED || '').toLowerCase() === 'off';
  const encryptionReady = sgdeEncryptionAvailable();
  const available = !off && encryptionReady;
  let message: string | undefined;
  if (off) message = 'SGDE desactivado en el servidor (SGDE_ENABLED=0).';
  else if (!encryptionReady) {
    message =
      'Falta SGDE_CREDENTIALS_KEY en el servidor para guardar contraseñas SGDE por usuario.';
  }
  return {
    available,
    encryptionReady,
    globallyDisabled: off,
    portalBaseUrl: getDefaultSgdeBaseUrl(),
    message,
  };
}

/** @deprecated Use sgdePlatformState + credenciales por usuario. */
export function sgdeIntegrationState(): {
  enabled: boolean;
  configured: boolean;
  portalBaseUrl: string;
} {
  const platform = sgdePlatformState();
  return {
    enabled: platform.available,
    configured: platform.encryptionReady,
    portalBaseUrl: platform.portalBaseUrl,
  };
}

export async function createLoggedInSgdeClientForUser(
  admin: SupabaseClient,
  userId: string
): Promise<{ client: SgdeClient; portalBaseUrl: string } | { error: string; code?: string }> {
  const platform = sgdePlatformState();
  if (!platform.available) {
    return {
      error: platform.message || 'SGDE no disponible en el servidor.',
      code: 'PLATFORM_UNAVAILABLE',
    };
  }

  const creds = await getUserSgdeCredentials(admin, userId);
  if (!creds?.username || !creds.password) {
    return {
      error:
        'No ha configurado sus credenciales SGDE. Vaya a Ajustes → Interconexión SGDE e ingrese su usuario y contraseña de la Rama.',
      code: 'USER_NOT_CONFIGURED',
    };
  }

  const client = new SgdeClient(getDefaultSgdeBaseUrl());
  client.setCredentials(creds.username, creds.password);
  const loginRes = await client.login();
  if (loginRes.ok === false) {
    return {
      error: `No se pudo autenticar en SGDE con su usuario: ${loginRes.message}`,
      code: 'LOGIN_FAILED',
    };
  }
  return { client, portalBaseUrl: platform.portalBaseUrl };
}
