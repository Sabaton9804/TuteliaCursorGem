/**
 * Tras quitar numerales opcionales del auto, renumera 1…n en el bloque entre «DISPONE:» y «COMUNÍQUESE».
 * Solo toca líneas cuyo inicio (tras espacios) es `dígitos + punto + espacio`.
 */
const LINEA_NUMERAL = /^(\s*)(\d+)(\.\s)(.*)$/;

export function renumberJudicialDisponeNumerals(text: string): string {
  if (!text.trim()) return text;
  const lines = text.split('\n');
  const disponeIdx = lines.findIndex((l) => /^\s*DISPONE\s*:/i.test(l));
  /** Sin «DISPONE:» no se renumera: evita alterar listas fuera del dispositivo. */
  if (disponeIdx < 0) return text;
  const start = disponeIdx + 1;
  const comunIdx = lines.findIndex((l, i) => i >= start && /^\s*COMUN[IÍ]QUESE/i.test(l));
  const end = comunIdx >= 0 ? comunIdx : lines.length;

  let n = 1;
  for (let i = start; i < end; i++) {
    const m = lines[i].match(LINEA_NUMERAL);
    if (!m) continue;
    const num = Number(m[2]);
    if (!Number.isFinite(num) || num < 1 || num > 99) continue;
    lines[i] = `${m[1]}${n}${m[3]}${m[4]}`;
    n += 1;
  }
  return lines.join('\n');
}
