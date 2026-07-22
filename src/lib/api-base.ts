/**
 * Base del backend Express. Vacío = mismo origen (`npm run dev`).
 * Cloudflare Pages: definir `VITE_API_URL` en variables de **build** (p. ej. Railway/Render).
 */
export function getApiBaseUrl(): string {
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
