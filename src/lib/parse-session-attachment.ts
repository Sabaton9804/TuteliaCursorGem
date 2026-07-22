import { apiAuthHeaders } from './supabase-write-auth';
import { apiUrl } from './api-base';

export type ParseSessionAttachmentMeta = {
  sessionIndex: number;
  filename: string;
  originalName?: string;
  contentType: string;
  size: number;
  isFromLink?: boolean;
  hasBuffer?: boolean;
};

/** Descarga un adjunto binario de una sesión temporal creada por POST /api/parse-email. */
export async function fetchParseSessionAttachment(
  parseSessionId: string,
  sessionIndex: number
): Promise<Uint8Array> {
  const headers = await apiAuthHeaders({ json: false });
  const res = await fetch(
    apiUrl(`/api/parse-session/${encodeURIComponent(parseSessionId)}/attachment/${sessionIndex}`),
    { headers },
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Lista metadatos de adjuntos en la sesión (sin bytes). */
export async function listParseSessionAttachments(
  parseSessionId: string,
): Promise<ParseSessionAttachmentMeta[]> {
  const headers = await apiAuthHeaders({ json: true });
  const res = await fetch(apiUrl(`/api/parse-session/${encodeURIComponent(parseSessionId)}`), {
    headers,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as { attachments?: ParseSessionAttachmentMeta[] };
  return Array.isArray(body.attachments) ? body.attachments : [];
}

function normalizeAttachmentName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/\s+/g, '');
}

/** Empareja un adjunto del cliente con el índice de sesión por nombre. */
export function matchSessionIndexByFilename(
  filename: string,
  sessionRows: ParseSessionAttachmentMeta[],
): number | null {
  const target = normalizeAttachmentName(filename);
  if (!target) return null;
  const hit =
    sessionRows.find((r) => normalizeAttachmentName(r.filename) === target) ||
    sessionRows.find((r) => normalizeAttachmentName(r.originalName || '') === target);
  return typeof hit?.sessionIndex === 'number' ? hit.sessionIndex : null;
}

/** Sube un PDF a la sesión de parseo (o crea sesión si no hay id). */
export async function uploadParseSessionAttachment(opts: {
  parseSessionId?: string | null;
  bytes: Uint8Array;
  filename: string;
  contentType?: string;
  isFromLink?: boolean;
}): Promise<{ parseSessionId: string; sessionIndex: number; size: number }> {
  const headers = await apiAuthHeaders({ json: false });
  const form = new FormData();
  const copy = new Uint8Array(opts.bytes.byteLength);
  copy.set(opts.bytes);
  const blob = new Blob([copy], {
    type: opts.contentType || 'application/pdf',
  });
  form.append('file', blob, `${opts.filename.replace(/\.[^.]+$/, '')}.pdf`);
  form.append('filename', opts.filename.replace(/\.[^.]+$/, '') || 'Documento');
  form.append('contentType', opts.contentType || 'application/pdf');
  if (opts.isFromLink) form.append('isFromLink', 'true');

  const url = opts.parseSessionId
    ? apiUrl(`/api/parse-session/${encodeURIComponent(opts.parseSessionId)}/upload`)
    : apiUrl('/api/parse-session');
  const res = await fetch(url, { method: 'POST', headers, body: form });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as {
    parseSessionId?: string;
    attachment?: { sessionIndex?: number; size?: number };
  };
  const sid = body.parseSessionId || opts.parseSessionId;
  const idx = body.attachment?.sessionIndex;
  if (!sid || typeof idx !== 'number') {
    throw new Error('El servidor no devolvió sessionIndex del PDF unificado.');
  }
  return {
    parseSessionId: sid,
    sessionIndex: idx,
    size: typeof body.attachment?.size === 'number' ? body.attachment.size : opts.bytes.length,
  };
}

/** Base64 desde Uint8Array (navegador; por trozos para no reventar el stack). */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
