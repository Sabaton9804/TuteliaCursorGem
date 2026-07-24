/** TLS hacia SGDE: en redes corporativas la cadena del portal suele fallar en Node. */

function envTruthy(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isSgdeTlsInsecure(): boolean {
  if (envTruthy('SGDE_TLS_INSECURE')) return true;
  if (envTruthy('OPENAI_TLS_INSECURE')) return true;
  return process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
}

export function formatSgdeConnectionError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('unable to verify') ||
    lower.includes('certificate') ||
    lower.includes('cert_') ||
    lower.includes('self signed')
  ) {
    return (
      'No se pudo conectar al portal SGDE por verificación del certificado TLS (común con proxy o antivirus corporativo). ' +
      'El administrador de Jurion puede añadir SGDE_TLS_INSECURE=1 en el .env del servidor y reiniciar npm run dev ' +
      '(solo diagnóstico en red local). En producción conviene NODE_EXTRA_CA_CERTS con el certificado de la CA de la Rama.'
    );
  }
  return raw;
}
