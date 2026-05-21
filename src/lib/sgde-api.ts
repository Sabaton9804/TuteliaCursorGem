import { supabase } from './supabase';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';

export type SgdePreflightStatus =
  | 'listo'
  | 'incompleto'
  | 'sin_documentos'
  | 'no_encontrado'
  | 'solo_compartidos'
  | 'error_login';

export type SgdePreflightResult = {
  ok: boolean;
  status: SgdePreflightStatus;
  originRadicado: string;
  sgdeRootId: string | null;
  rootName: string | null;
  pdfCount: number;
  recommendedFound: string[];
  recommendedMissing: string[];
  sampleFiles: string[];
  message: string;
  portalBaseUrl?: string;
  error?: string;
  code?: string;
};

export type SgdeUserStatus = {
  enabled: boolean;
  configured: boolean;
  userConfigured: boolean;
  usernameMasked: string | null;
  credentialsUpdatedAt: string | null;
  portalBaseUrl: string;
  encryptionReady: boolean;
  globallyDisabled: boolean;
  message?: string;
};

export type SegundaInstanciaEmailParse = {
  isSegundaInstancia: boolean;
  originRadicado: string | null;
  originCourt: string | null;
  motivo: string | null;
  sentenciaFecha: string | null;
  repartoSecuencia: string | null;
  sgdeNodeId?: string | null;
};

export type MigrateSgdeOriginResult = {
  ok: boolean;
  sgdeRootId: string;
  migrated: number;
  skipped: number;
  failed: number;
  errors: string[];
  documentIds: string[];
  error?: string;
};

async function authHeaders(): Promise<HeadersInit> {
  await ensureSupabaseSessionForWrites();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Inicie sesión en Tutelia para usar SGDE.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchSgdeUserStatus(): Promise<SgdeUserStatus> {
  const res = await fetch('/api/sgde/status', { headers: await authHeaders() });
  const body = (await res.json().catch(() => ({}))) as SgdeUserStatus & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Error al consultar SGDE (${res.status})`);
  }
  return body;
}

export async function saveSgdeCredentials(username: string, password: string): Promise<void> {
  const res = await fetch('/api/sgde/credentials', {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || 'No se pudieron guardar las credenciales SGDE.');
}

export async function deleteSgdeCredentials(): Promise<void> {
  const res = await fetch('/api/sgde/credentials', {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || 'No se pudieron eliminar las credenciales SGDE.');
}

export async function sgdePreflightOrigin(
  originRadicado: string,
  sgdeNodeIdHint?: string | null
): Promise<SgdePreflightResult> {
  const res = await fetch('/api/sgde/preflight-origin', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ originRadicado, sgdeNodeIdHint: sgdeNodeIdHint || undefined }),
  });
  const body = (await res.json().catch(() => ({}))) as SgdePreflightResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes antes de consultar el traslado.'
        : body.error || body.message || `Error ${res.status}`;
    return {
      ok: false,
      status: 'error_login',
      originRadicado: originRadicado.replace(/\D/g, ''),
      sgdeRootId: null,
      rootName: null,
      pdfCount: 0,
      recommendedFound: [],
      recommendedMissing: [],
      sampleFiles: [],
      message: msg,
      error: body.error,
      code: body.code,
    };
  }
  return body;
}

export async function sgdeMigrateOriginToCase(opts: {
  caseId: string;
  originRadicado: string;
  sgdeRootId?: string | null;
  sgdeNodeIdHint?: string | null;
  notebookCode?: string;
  force?: boolean;
}): Promise<MigrateSgdeOriginResult> {
  const res = await fetch('/api/sgde/migrate-origin-to-case', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      originRadicado: opts.originRadicado,
      sgdeRootId: opts.sgdeRootId || undefined,
      sgdeNodeIdHint: opts.sgdeNodeIdHint || undefined,
      notebookCode: opts.notebookCode,
      force: opts.force,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as MigrateSgdeOriginResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Error al migrar desde SGDE (${res.status})`);
  }
  return body;
}

export function parseSegundaInstanciaClient(
  subject: string,
  text: string,
  html?: string
): SegundaInstanciaEmailParse {
  const stripHtml = (h: string) =>
    h
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const combined = `${subject}\n${text}\n${html ? stripHtml(html) : ''}`;
  const isSegundaInstancia =
    /\bAPELACI[ÓO]N\b/i.test(combined) ||
    /\bACTA\s+DE\s+REPARTO\b/i.test(combined) ||
    /\befecto\s+SUSPENSIVO\b/i.test(combined) ||
    /\bExpediente:\s*\d{23}/i.test(combined);

  let originRadicado: string | null = null;
  const exp = combined.match(/Expediente:\s*(\d{23})/i);
  if (exp) originRadicado = exp[1];
  if (!originRadicado) {
    const sub = subject.match(/\b(\d{23})\b/);
    if (sub) originRadicado = sub[1];
  }

  let originCourt: string | null = null;
  const court = combined.match(/Despacho\s+custodio:\s*([^\n\r]+)/i);
  if (court) originCourt = court[1].trim();

  let motivo: string | null = null;
  const mot = combined.match(/Motivo:\s*([^\n\r_]+)/i);
  if (mot) motivo = mot[1].trim().slice(0, 500);

  let sentenciaFecha: string | null = null;
  const fec = combined.match(/sentencia\s+de\s+fecha\s+([^,\n\r]+)/i);
  if (fec) sentenciaFecha = fec[1].trim();

  let repartoSecuencia: string | null = null;
  const seq = combined.match(/REPARTO\s+SECUENCIA:\s*(\d+)/i);
  if (seq) repartoSecuencia = seq[1];

  const sgdeNodeId = (() => {
    const decoded = combined.replace(/&amp;/g, '&').replace(/%2F/gi, '/');
    const patterns = [
      /\/nodes\/([0-9a-f-]{36})/i,
      /nodeId[=:]([0-9a-f-]{36})/i,
      /\/ficheror\/([0-9a-f-]{36})/i,
    ];
    for (const re of patterns) {
      const m = decoded.match(re);
      if (m?.[1]) return m[1].toLowerCase();
    }
    const uuids = [...decoded.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)];
    if (uuids.length === 1) return uuids[0][0].toLowerCase();
    return null;
  })();

  return {
    isSegundaInstancia,
    originRadicado,
    originCourt,
    motivo,
    sentenciaFecha,
    repartoSecuencia,
    sgdeNodeId,
  };
}

export const SGDE_RECOMMENDED_LABELS: Record<string, string> = {
  sentencia_fallo: 'Sentencia / fallo de origen',
  apelacion_memorial: 'Memorial / recurso de apelación',
  notificacion: 'Notificaciones / constancias',
};
