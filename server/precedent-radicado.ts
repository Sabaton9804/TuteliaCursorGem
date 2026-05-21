/** Placeholder cuando index-from-file no obtiene radicado (editable en biblioteca). */
export const PRECEDENT_RADICADO_PENDIENTE = 'PENDIENTE';

/**
 * Normaliza CUI de 23 dígitos; preserva referencias (T-760/08, SU-062/18, PENDIENTE, etc.).
 */
export function normalizeRadicado(raw: string): string {
  const original = String(raw || '').trim();
  if (!original) return '';
  const compact = original.replace(/[\s-]+/g, '');
  if (compact.length === 23 && /^\d{23}$/.test(compact)) {
    return compact;
  }
  return original;
}

/** Busca un CUI de 23 dígitos en texto largo (p. ej. fallo extraído por IA). */
export function extractRadicado23FromText(text: string): string | null {
  const digitsOnly = String(text || '').replace(/\D/g, '');
  const m = digitsOnly.match(/\d{23}/);
  return m ? m[0] : null;
}
