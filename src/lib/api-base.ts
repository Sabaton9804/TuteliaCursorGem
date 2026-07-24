/**
 * Base del backend Express. Vacío = mismo origen (`npm run dev` o Pages con proxy `/api`).
 */
function readConfiguredApiBase(): string {
  const raw =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_URL) ||
    '';
  return String(raw).trim().replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  // Override explícito: llamar al backend cross-origin (requiere CORS_ORIGIN en Render).
  if (import.meta.env?.VITE_USE_RENDER_API === '1') {
    return readConfiguredApiBase();
  }

  const configured = readConfiguredApiBase();
  if (!configured || typeof window === 'undefined') {
    return configured;
  }

  try {
    const apiHost = new URL(configured).host;
    // API en otro host → usar /api relativo (Cloudflare Pages Functions → Render).
    if (apiHost !== window.location.host) {
      return '';
    }
  } catch {
    return configured;
  }

  return configured;
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
      'No se pudo contactar el servidor API. Recargue con Ctrl+Shift+R (caché). ' +
      'Las peticiones deben ir a /api/… en pages.dev, no a onrender.com.'
    );
  }
  return msg;
}
