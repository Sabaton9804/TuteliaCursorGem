import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const ALLOWED_HOST_SUFFIXES = [
  'ramajudicial.gov.co',
  'corteconstitucional.gov.co',
  'consejodeestado.gov.co',
  'cortessuprema.gov.co',
] as const;

const MAX_REDIRECTS = 5;

/** Desenvuelve SafeLinks/AMP y deja la URL real de Demanda en línea / archivo. */
export function unwrapJudicialArchiveUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url = String(raw).replace(/&amp;/g, '&').trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase().includes('safelinks.protection.outlook.com')) {
      const inner = u.searchParams.get('url');
      if (inner) url = inner.trim();
    }
  } catch {
    /* conservar url parcialmente limpia */
  }
  return url || null;
}

export class UnsafeJudicialArchiveUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeJudicialArchiveUrlError';
  }
}

export function isAllowedJudicialArchiveHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || isIP(h)) return false;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

export function isBlockedIpAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) return isBlockedIpv4(address);
  if (v === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return isBlockedIpv4(mapped);
  }
  return false;
}

export async function assertSafeJudicialArchiveUrl(raw: string): Promise<URL> {
  const unwrapped = unwrapJudicialArchiveUrl(raw);
  if (!unwrapped) {
    throw new UnsafeJudicialArchiveUrlError('URL de archivo judicial vacía o inválida.');
  }
  let parsed: URL;
  try {
    parsed = new URL(unwrapped);
  } catch {
    throw new UnsafeJudicialArchiveUrlError('URL de archivo judicial malformada.');
  }
  if (parsed.protocol !== 'https:') {
    throw new UnsafeJudicialArchiveUrlError('Solo se permite HTTPS para descargar el archivo judicial.');
  }
  if (!isAllowedJudicialArchiveHostname(parsed.hostname)) {
    throw new UnsafeJudicialArchiveUrlError(
      'El enlace no pertenece a un dominio judicial permitido (Rama Judicial u órganos de cierre).',
    );
  }
  let records: { address: string; family: number }[];
  try {
    records = await lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeJudicialArchiveUrlError('No se pudo resolver el host del archivo judicial.');
  }
  if (!records.length || records.some((r) => isBlockedIpAddress(r.address))) {
    throw new UnsafeJudicialArchiveUrlError('El host del archivo judicial resuelve a una dirección no permitida.');
  }
  return parsed;
}

export { MAX_REDIRECTS as JUDICIAL_ARCHIVE_MAX_REDIRECTS };
