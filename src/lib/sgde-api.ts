import { supabase } from './supabase';
import { resolveOriginRadicadoFromRepartoEmail } from './reparto-origin-cui';
import { extractSegundaFieldsFromText } from './segunda-instancia-extract';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';
import type { CaseAppellant, CaseOriginRuling } from '../types';

export type SgdePreflightStatus =
  | 'listo'
  | 'incompleto'
  | 'sin_documentos'
  | 'no_encontrado'
  | 'solo_compartidos'
  | 'error_login';

export type SgdePreflightPdfFile = {
  id: string;
  name: string;
  path: string;
};

export type SgdePreflightTreeNode = {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  children?: SgdePreflightTreeNode[];
};

export type SegundaFieldsExtract = {
  appellant: CaseAppellant | null;
  originRuling: CaseOriginRuling | null;
  sources: string[];
};

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
  pdfFiles?: SgdePreflightPdfFile[];
  documentTree?: SgdePreflightTreeNode[];
  segundaExtract?: SegundaFieldsExtract | null;
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
  appellant?: CaseAppellant | null;
  originRuling?: CaseOriginRuling | null;
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

export type ImportFromSgdeResult = {
  ok: boolean;
  caseId: string;
  created: boolean;
  radicado: string;
  originRadicado: string | null;
  sgdeRootId: string;
  migrated: number;
  failed: number;
  skipped: number;
  errors: string[];
  preflightStatus: SgdePreflightStatus;
  message: string;
  portalBaseUrl?: string;
  error?: string;
  code?: string;
};

export type PublishSegundaImpugnacionResult = {
  ok: boolean;
  sgdeRootId: string;
  impugnacionFolderId: string;
  uploaded: number;
  uploadFailed: number;
  uploadErrors: string[];
  message: string;
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

export type CreateSgdeExpedienteResult = {
  ok: boolean;
  sgdeRootId: string;
  yaExiste?: boolean;
  uploaded: number;
  uploadFailed: number;
  uploadErrors: string[];
  message: string;
  error?: string;
};

export type SgdeDocumentSyncItem = {
  status: 'linked' | 'local_only' | 'sgde_only';
  name: string;
  documentId?: string;
  sgdeId?: string;
  sgdeFolderPath?: string;
  notebookCode?: string;
};

export type SgdeSyncDocumentsResult = {
  ok: boolean;
  linked: number;
  localOnly: number;
  sgdeOnly: number;
  uploaded: number;
  uploadFailed: number;
  repaired?: number;
  imported?: number;
  repairFailed?: number;
  items: SgdeDocumentSyncItem[];
  sgdeOnlyItems: SgdeDocumentSyncItem[];
  errors: string[];
  message: string;
  sgdeRootId: string;
};

export type SgdeRepairStorageResult = {
  ok: boolean;
  repaired: number;
  imported: number;
  failed: number;
  skipped: number;
  errors: string[];
  message: string;
  portalBaseUrl?: string;
  error?: string;
  code?: string;
};

export async function sgdeSyncDocuments(opts: {
  caseId: string;
  uploadMissing?: boolean;
}): Promise<SgdeSyncDocumentsResult> {
  const res = await fetch('/api/sgde/sync-documents', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      uploadMissing: opts.uploadMissing,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as SgdeSyncDocumentsResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes.'
        : body.error || `Error al sincronizar (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export async function sgdeRepairStorage(opts: {
  caseId: string;
  importSgdeOnly?: boolean;
}): Promise<SgdeRepairStorageResult> {
  const res = await fetch('/api/sgde/repair-storage', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      importSgdeOnly: opts.importSgdeOnly !== false,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as SgdeRepairStorageResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes.'
        : body.error || `Error al reparar Storage (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export type SgdeDocumentViewUrlResult = {
  signedUrl: string;
  storagePath: string;
  repaired: boolean;
};

export async function sgdeDocumentViewUrl(opts: {
  caseId: string;
  documentId: string;
}): Promise<SgdeDocumentViewUrlResult> {
  const res = await fetch('/api/sgde/document-view-url', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      documentId: opts.documentId,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as SgdeDocumentViewUrlResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `No se pudo abrir el PDF (${res.status})`);
  }
  if (!body.signedUrl) {
    throw new Error('Respuesta sin URL firmada.');
  }
  return {
    signedUrl: body.signedUrl,
    storagePath: body.storagePath,
    repaired: body.repaired === true,
  };
}

export async function sgdeCreateExpediente(opts: {
  caseId: string;
  uploadDocuments?: boolean;
}): Promise<CreateSgdeExpedienteResult> {
  const res = await fetch('/api/sgde/create-expediente', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      uploadDocuments: opts.uploadDocuments,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as CreateSgdeExpedienteResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes.'
        : body.error || `Error al crear expediente en SGDE (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export async function sgdePreflightOrigin(
  originRadicado: string,
  sgdeNodeIdHint?: string | null,
  emailDigest?: string | null
): Promise<SgdePreflightResult> {
  const res = await fetch('/api/sgde/preflight-origin', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      originRadicado,
      sgdeNodeIdHint: sgdeNodeIdHint || undefined,
      emailDigest: emailDigest?.trim() || undefined,
    }),
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
      pdfFiles: [],
      documentTree: [],
      segundaExtract: null,
      message: msg,
      error: body.error,
      code: body.code,
    };
  }
  return body;
}

export async function sgdePreviewNodeBytes(nodeId: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
  size: number;
}> {
  const headers = await authHeaders();
  const res = await fetch('/api/sgde/preview-node', {
    method: 'POST',
    headers: { ...headers, Accept: 'application/pdf' },
    body: JSON.stringify({ nodeId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes.'
        : body.error || `Error al obtener vista previa (${res.status})`;
    throw new Error(msg);
  }
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error('SGDE no devolvió contenido del documento.');
  const ct = res.headers.get('content-type') || 'application/pdf';
  return {
    bytes: new Uint8Array(buf),
    contentType: ct.split(';')[0].trim(),
    size: buf.byteLength,
  };
}

export async function sgdePublishSegundaImpugnacion(opts: {
  caseId: string;
  originRadicado: string;
  sgdeRootId?: string | null;
}): Promise<PublishSegundaImpugnacionResult> {
  const res = await fetch('/api/sgde/publish-segunda-impugnacion', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      originRadicado: opts.originRadicado.replace(/\D/g, ''),
      sgdeRootId: opts.sgdeRootId || undefined,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as PublishSegundaImpugnacionResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes.'
        : body.error || `Error al publicar en SGDE (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export async function sgdeImportExpediente(opts: {
  caseType: 'tutela_primera' | 'tutela_segunda';
  radicado: string;
  sgdeNodeIdHint?: string | null;
  originCourt?: string;
  appellant?: CaseAppellant | null;
  originRuling?: CaseOriginRuling | null;
  forceMigrate?: boolean;
}): Promise<ImportFromSgdeResult> {
  const res = await fetch('/api/sgde/import-expediente', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseType: opts.caseType,
      radicado: opts.radicado.replace(/\D/g, ''),
      sgdeNodeIdHint: opts.sgdeNodeIdHint || undefined,
      originCourt: opts.originCourt,
      appellant: opts.appellant || undefined,
      originRuling: opts.originRuling || undefined,
      forceMigrate: opts.forceMigrate === true,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as ImportFromSgdeResult & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes.'
        : body.error || `Error al importar desde SGDE (${res.status})`;
    throw new Error(msg);
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
  // “Apelación” en correos/SGDE: solo heurística; etiquetas visibles = impugnación.
  const isSegundaInstancia =
    /\bAPELACI[ÓO]N\b/i.test(combined) ||
    /\brecurso\s+de\s+apelaci[oó]n\b/i.test(combined) ||
    /\bACTA\s+DE\s+REPARTO\b/i.test(combined) ||
    /\befecto\s+SUSPENSIVO\b/i.test(combined) ||
    /\bREMISI[ÓO]N\s+(?:EXPEDIENTE|DEL\s+EXPEDIENTE)\b/i.test(combined) ||
    (/\bREMISI[ÓO]N\b/i.test(combined) && /\bTUTELA\b/i.test(combined)) ||
    /\bIMPUGNACI[ÓO]N\b/i.test(combined) ||
    /\bSolicitud\s+de\s+traslado\b/i.test(combined) ||
    /\btraslado\s+del\s+proceso\s+judicial\b/i.test(combined) ||
    /\bExpediente:\s*\d{23}/i.test(combined);

  const reparto = resolveOriginRadicadoFromRepartoEmail(subject, combined);
  let originRadicado: string | null = reparto.originRadicado;
  let originCourt: string | null = reparto.originCourt;
  if (!originCourt) {
    const court = combined.match(/Despacho\s+custodio:\s*([^\n\r]+)/i);
    if (court) originCourt = court[1].trim();
  }

  let motivo: string | null = null;
  const mot = combined.match(/Motivo:\s*([^\n\r_]+)/i);
  if (mot) motivo = mot[1].trim().slice(0, 500);

  let sentenciaFecha: string | null = null;
  const fec = combined.match(/sentencia\s+de\s+fecha\s+([^,\n\r]+)/i);
  if (fec) sentenciaFecha = fec[1].trim();

  let repartoSecuencia: string | null = null;
  const seq = combined.match(/REPARTO\s+SECUENCIA:\s*(\d+)/i);
  if (seq) repartoSecuencia = seq[1];
  if (!repartoSecuencia) {
    const subjSeq = subject.match(/\bSECUENCIA\s+(\d{1,6})\b/i);
    if (subjSeq) repartoSecuencia = subjSeq[1];
  }

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

  const fields = extractSegundaFieldsFromText(combined, 'Cuerpo del correo');

  return {
    isSegundaInstancia,
    originRadicado,
    originCourt,
    motivo,
    sentenciaFecha,
    repartoSecuencia,
    sgdeNodeId,
    appellant: fields.appellant,
    originRuling: fields.originRuling,
  };
}

export type SgdeSignDocumentResult = {
  ok: boolean;
  message: string;
  refreshed?: boolean;
  portalBaseUrl?: string;
  error?: string;
  code?: string;
};

export async function sgdeSignDocument(opts: {
  caseId: string;
  documentId: string;
  username?: string;
  password?: string;
  refreshLocal?: boolean;
}): Promise<SgdeSignDocumentResult> {
  const res = await fetch('/api/sgde/sign-document', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      documentId: opts.documentId,
      username: opts.username,
      password: opts.password,
      refreshLocal: opts.refreshLocal,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as SgdeSignDocumentResult;
  if (!res.ok) {
    const msg =
      body.code === 'USER_NOT_CONFIGURED'
        ? 'Configure su usuario y contraseña SGDE en Ajustes.'
        : body.error || body.message || `Error al firmar (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export const SGDE_RECOMMENDED_LABELS: Record<string, string> = {
  sentencia_fallo: 'Sentencia / fallo de origen',
  impugnacion_memorial: 'Escrito / memorial de impugnación',
  notificacion: 'Notificaciones / constancias',
};
