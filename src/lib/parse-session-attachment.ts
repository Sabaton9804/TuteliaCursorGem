import { apiAuthHeaders } from './supabase-write-auth';

/** Descarga un adjunto binario de una sesión temporal creada por POST /api/parse-email. */
export async function fetchParseSessionAttachment(
  parseSessionId: string,
  sessionIndex: number
): Promise<Uint8Array> {
  const headers = await apiAuthHeaders({ json: false });
  const res = await fetch(
    `/api/parse-session/${encodeURIComponent(parseSessionId)}/attachment/${sessionIndex}`,
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

/** Base64 desde Uint8Array (navegador; por trozos para no reventar el stack). */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
