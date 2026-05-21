import axios from 'axios';

export function isOutlookTlsInsecureEnv(): boolean {
  return (
    process.env.OUTLOOK_TLS_INSECURE === '1' ||
    process.env.OPENAI_TLS_INSECURE === '1'
  );
}

/** Mensaje legible a partir de errores de login.microsoftonline.com (axios). */
export function formatMicrosoftOAuthError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const raw = err.response?.data;
    let description = '';
    if (raw && typeof raw === 'object' && 'error_description' in raw) {
      description = String((raw as { error_description?: string }).error_description || '');
    } else if (typeof raw === 'string') {
      description = raw;
    }
    const lower = description.toLowerCase();

    if (lower.includes('7000215') || lower.includes('invalid client secret')) {
      return (
        'Secreto de cliente inválido o expirado. En Azure → Certificados y secretos, cree un secreto nuevo y copie el VALOR (no el ID del secreto) a OUTLOOK_CLIENT_SECRET en .env. Reinicie el servidor.'
      );
    }
    if (lower.includes('700016') || lower.includes('application was not found')) {
      return 'Client ID no encontrado. Revise OUTLOOK_CLIENT_ID en .env.';
    }
    if (lower.includes('redirect_uri') || lower.includes('redirect uri')) {
      return (
        'El redirect_uri no coincide. En Azure (plataforma Web) registre exactamente: ' +
        (process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:3000/api/outlook/callback')
      );
    }
    if (lower.includes('invalid_grant') || lower.includes('authorization code')) {
      return 'Código de autorización inválido o ya usado. Pulse «Conectar Outlook» de nuevo sin recargar una URL antigua.';
    }
    if (status === 401) {
      return (
        'Microsoft rechazó la autenticación (401). Revise OUTLOOK_CLIENT_SECRET (valor del secreto, no el ID), el URI de redirección y que la app tenga permisos delegados Mail.Read y Mail.Send con consentimiento.'
      );
    }
    if (description.trim()) return description.slice(0, 500);
    if (status) return `Error de Microsoft (${status}). ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Error al comunicarse con Microsoft.';
}
