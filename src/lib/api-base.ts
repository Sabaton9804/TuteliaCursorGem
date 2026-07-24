/**
 * Base del backend Express. Vacío = mismo origen (`npm run dev` o Pages con proxy `/api`).
 */
export function getApiBaseUrl(): string {
  const onPages =
    typeof window !== 'undefined' && /\.pages\.dev$/i.test(window.location.hostname);
  // Pages + functions/api proxy: mismo origen (sin CORS). Override explícito: VITE_USE_RENDER_API=1
  if (onPages && import.meta.env?.VITE_USE_RENDER_API !== '1') {
    return '';
  }
  const raw =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_URL) ||
    '';
  return String(raw).trim().replace(/\/+$/, '');
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${p}` : p;
}

/** Despierta el backend (Render) vía /api/health — directo o proxy Pages. */
export async function warmupApiBackend(opts?: { maxAttempts?: number; delayMs?: number }): Promise<boolean> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const delayMs = opts?.delayMs ?? 4000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(apiUrl('/api/health'), { method: 'GET', cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      /* cold start / red */
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

export function describeApiFetchFailure(err: unknown, status?: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return (
      `El servidor API no respondió (${status ?? 'sin respuesta'}). En Render plan gratuito el servicio se duerme tras inactividad: espere ~30 s y reintente. ` +
      'Si persiste, revise los logs en Render (Dashboard → su servicio → Logs).'
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return (
      'No se pudo contactar el servidor API. Si usa Cloudflare Pages, despliegue con el proxy functions/api ' +
      '(BACKEND_URL en Cloudflare) o espere a que Render despierte (~30 s).'
    );
  }
  return msg;
}
