/**
 * Proxy /api/* → backend Express (Render). Mismo origen en Pages: sin CORS.
 *
 * Cloudflare Pages → Settings → Environment variables (Production):
 *   BACKEND_URL = https://tuteliacursorgem.onrender.com
 *
 * Build Pages: NO definir VITE_API_URL (o vacío) para que el frontend use /api relativo.
 */
type PagesContext = {
  request: Request;
  params: { path?: string | string[] };
  env: { BACKEND_URL?: string };
};

const DEFAULT_BACKEND = 'https://tuteliacursorgem.onrender.com';

function apiPathParam(path: string | string[] | undefined): string {
  if (Array.isArray(path)) return path.map((s) => encodeURIComponent(s)).join('/');
  if (path) return encodeURIComponent(path);
  return '';
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const backend = (context.env.BACKEND_URL || DEFAULT_BACKEND).replace(/\/+$/, '');
  const segments = apiPathParam(context.params.path);
  const incoming = new URL(context.request.url);
  const target = `${backend}/api/${segments}${incoming.search}`;

  const headers = new Headers(context.request.headers);
  headers.delete('host');

  const init: RequestInit & { duplex?: 'half' } = {
    method: context.request.method,
    headers,
    redirect: 'manual',
  };

  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = context.request.body;
    init.duplex = 'half';
  }

  try {
    return await fetch(target, init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'Backend no disponible. Render puede estar despertando; reintente en 30 s.',
        detail: String((err as Error)?.message || err),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
