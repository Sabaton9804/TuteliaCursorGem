/**
 * Cliente OpenAI usa fetch (Undici), que en Windows/red corporativa puede ignorar
 * NODE_TLS_REJECT_UNAUTHORIZED. Este fetch enruta HTTPS por node:https con agente inseguro.
 * Solo cuando OPENAI_TLS_INSECURE=1 (ver getOpenAiClient en server.ts).
 */
import https from 'node:https';
import { URL } from 'node:url';

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

async function bodyInitToBuffer(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body == null || body === '') return undefined;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return Buffer.from(body.toString(), 'utf8');
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (typeof (body as ReadableStream).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const parts: Buffer[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) parts.push(Buffer.from(value));
    }
    return parts.length ? Buffer.concat(parts) : undefined;
  }
  return undefined;
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const o: Record<string, string> = {};
    h.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }
  if (Array.isArray(h)) {
    const o: Record<string, string> = {};
    for (const [k, v] of h) o[k] = v;
    return o;
  }
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v != null) o[k] = String(v);
  }
  return o;
}

export function createOpenAiTlsInsecureFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') {
      return globalThis.fetch(input as RequestInfo, init);
    }

    const method = (init?.method || 'GET').toUpperCase();
    const headerRec = headersToRecord(init?.headers);
    const buf = await bodyInitToBuffer(init?.body ?? null);

    if (init?.body != null && buf === undefined) {
      throw new Error(
        '[OPENAI_TLS_INSECURE] Cuerpo de petición no soportado por el fetch HTTPS alternativo; use NODE_EXTRA_CA_CERTS.'
      );
    }

    if (buf && !headerRec['content-length'] && !headerRec['Content-Length']) {
      headerRec['Content-Length'] = String(buf.length);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: `${parsed.pathname}${parsed.search}`,
          method,
          agent: insecureAgent,
          headers: headerRec,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const responseHeaders = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v == null) continue;
              const val = Array.isArray(v) ? v.join(', ') : v;
              responseHeaders.set(k, val);
            }
            const payload = Buffer.concat(chunks);
            resolve(
              new Response(payload, {
                status: res.statusCode ?? 0,
                statusText: res.statusMessage,
                headers: responseHeaders,
              })
            );
          });
        }
      );
      req.on('error', reject);
      if (buf?.length) req.write(buf);
      req.end();
    });
  }) as typeof fetch;
}
