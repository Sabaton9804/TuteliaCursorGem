/**
 * Título legible para listados del expediente (no sustituye el nombre real del archivo en BD ni al descargar).
 * Quita sufijos típicos de exportación (_día_mes_año, hora_minuto) y normaliza guiones bajos.
 */

const SUFFIX_DD_MM_YYYY_COMMA_TIME = /_(\d{1,2})_(\d{1,2})_(\d{4}),\s*(\d{1,2})_(\d{1,2})_(\d{2})$/;

const SUFFIX_COMPACT_DATETIME = /_\d{8}[_-]\d{4,6}$/i;

function titleCaseSpanishWords(s: string): string {
  const small = new Set([
    'de',
    'del',
    'la',
    'las',
    'el',
    'los',
    'y',
    'e',
    'en',
    'por',
    'para',
    'al',
    'a',
    'o',
    'u',
  ]);
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (/^\d+$/.test(w)) return w;
      const lower = w.toLocaleLowerCase('es');
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
    })
    .join(' ');
}

/**
 * Devuelve el nombre tal como debe mostrarse en expediente (sanitizado).
 */
export function sanitizeExpedienteFilenameForDisplay(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return fullName;

  const lastDot = trimmed.lastIndexOf('.');
  const ext = lastDot >= 0 ? trimmed.slice(lastDot) : '';
  let base = lastDot >= 0 ? trimmed.slice(0, lastDot) : trimmed;
  const hadUnderscores = base.includes('_');

  if (/^correoreparto$/i.test(base.replace(/[\s_-]/g, ''))) {
    return `Correo de reparto${ext}`;
  }

  let strippedSuffix = 0;
  let prev: string;
  do {
    prev = base;
    const next = base.replace(SUFFIX_DD_MM_YYYY_COMMA_TIME, '');
    if (next !== base) strippedSuffix += 1;
    base = next;
  } while (base !== prev);

  base = base.replace(SUFFIX_COMPACT_DATETIME, '');
  base = base.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!base) return trimmed;

  const looksLikeAllCapsExport =
    base.length > 4 && /[A-ZÁÉÍÓÚÜÑ]/.test(base) && !/[a-záéíóúüñ]/.test(base);

  if (strippedSuffix > 0 || hadUnderscores || looksLikeAllCapsExport) {
    base = titleCaseSpanishWords(base.toLocaleLowerCase('es'));
  }

  return (base + ext).trim() || trimmed;
}
