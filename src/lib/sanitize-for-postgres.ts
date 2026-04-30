/**
 * PostgreSQL (jsonb) rechaza ciertos caracteres al interpretar el JSON que envía el cliente:
 * - U+0000 en cadenas (no representable en tipo text).
 * - Pares sustitutos UTF-16 incompletos (fallo «unsupported Unicode escape sequence»).
 *
 * Origen típico: HTML/correo o salida de IA con bytes sueltos o texto mal decodificado.
 */

export function sanitizeStringForPostgresText(s: string): string {
  const t = s.replace(/\u0000/g, '');
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < t.length ? t.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += t[i] + t[i + 1];
        i++;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // sustituto bajo suelto — omitir
    } else {
      out += t[i];
    }
  }
  return out;
}

/** Recorre objetos y arrays planos (JSON-serializable) y sanea todas las cadenas. */
export function deepSanitizeForPostgresInsert<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeStringForPostgresText(value) as T;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(deepSanitizeForPostgresInsert) as T;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const o = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      next[k] = deepSanitizeForPostgresInsert(o[k]);
    }
    return next as T;
  }
  return value;
}
