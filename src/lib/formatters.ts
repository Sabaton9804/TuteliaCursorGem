/**
 * Formats a 23-digit judicial radication number for display.
 * From: 11001310305120260060000
 * To: 11001-31-03-051-2026-00600-00
 */
export const formatRadicado = (radicado: string): string => {
  if (!radicado || radicado.length !== 23) return radicado;
  
  return [
    radicado.slice(0, 5),   // Ciudad/Dpto (11001)
    radicado.slice(5, 7),   // Corp (31)
    radicado.slice(7, 9),   // Especialidad (03)
    radicado.slice(9, 12),  // Despacho (051)
    radicado.slice(12, 16), // Año (2026)
    radicado.slice(16, 21), // Proceso (00600)
    radicado.slice(21, 23)  // Instancia (00)
  ].join('-');
};

/**
 * Lista de partes separadas con `;` o `,`: muestra la primera y «y otros» si hay más.
 * No parte por la palabra «y» (rompe razones sociales como «PROMOCIONES Y COBRANZAS … S.A.»).
 * El listado completo conviene dejarlo en `title` del elemento.
 */
export function formatPartesCompact(raw: string | undefined | null, empty = '—'): string {
  const text = (raw || '').trim();
  if (!text) return empty;
  const parts = text
    .split(/\s*;\s*|\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return empty;
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} y otros`;
}
