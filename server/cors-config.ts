import type { Request, Response, NextFunction } from 'express';

function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Convierte un patrón con `*` en RegExp (p. ej. `https://*.pages.dev`). */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
  return new RegExp(`^${escaped}$`, 'i');
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (!origin || allowed.length === 0) return false;
  const normalized = normalizeOrigin(origin);
  for (const entry of allowed) {
    if (entry === normalized) return true;
    if (entry.includes('*') && patternToRegExp(entry).test(normalized)) return true;
  }
  return false;
}

export function createCorsMiddleware(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin =
      typeof req.headers.origin === 'string' ? normalizeOrigin(req.headers.origin) : '';

    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, x-tutelia-mailbox-id'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    } else if (origin && req.method !== 'OPTIONS') {
      console.warn('[cors] origen rechazado:', origin, 'permitidos:', allowedOrigins.join(', ') || '(ninguno)');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(isOriginAllowed(origin, allowedOrigins) ? 204 : 403);
    }

    next();
  };
}

export function resolveCorsOriginsFromEnv(): string[] {
  const explicit = parseCorsOrigins(process.env.CORS_ORIGIN);
  if (explicit.length > 0) return explicit;
  return parseCorsOrigins(process.env.APP_URL);
}
