import type { DocumentTemplateToggleDef } from '../types';
import {
  MARKER_MEDIDA_PROVISIONAL,
  MARKER_VINCULADOS,
  TOGGLE_ID_AUTO_MEDIDA,
  TOGGLE_ID_AUTO_VINCULADOS,
} from './plantilla-template-default-toggles';
import { buildActiveToggleIds } from './tiptap-template-toggle-filter';

function plainTextHasBuiltinToggleMarkers(text: string): boolean {
  return (
    text.includes(`{{${MARKER_VINCULADOS}}}`) ||
    text.includes(`{{${MARKER_MEDIDA_PROVISIONAL}}}`) ||
    text.includes('{{BLOQUE_VINCULADOS}}') ||
    text.includes('{{BLOQUE_MEDIDA_PROVISIONAL}}')
  );
}

/**
 * Plantillas en texto plano antiguas: numerales 3 / 4 pegados sin `{{BLOQUE_*}}`.
 * Si el toggle está apagado, elimina el bloque típico (hasta el siguiente numeral o «COMUNÍQUESE»).
 */
function stripNumeralBlock(
  lines: string[],
  numeral: number,
  mustMatch: RegExp,
): string[] {
  const startRe = new RegExp(`^\\s*${numeral}\\.\\s`);
  const startIdx = lines.findIndex((ln) => startRe.test(ln) && mustMatch.test(ln));
  if (startIdx < 0) return lines;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const ln = lines[i] ?? '';
    if (/^\s*COMUN[IÍ]QUESE/i.test(ln)) {
      endIdx = i;
      break;
    }
    const m = ln.match(/^\s*(\d+)\.\s/);
    if (m && Number(m[1]) > numeral) {
      endIdx = i;
      break;
    }
  }
  return [...lines.slice(0, startIdx), ...lines.slice(endIdx)];
}

/** Líneas sueltas «—. (Bloque opcional…)» que quedan al desactivar toggles sin marcadores en plantilla. */
function stripOrphanOptionalHintLines(
  lines: string[],
  active: ReturnType<typeof buildActiveToggleIds>,
): string[] {
  return lines.filter((ln) => {
    if (/Bloque opcional/i.test(ln)) {
      if (/vincul/i.test(ln) && !active.has(TOGGLE_ID_AUTO_VINCULADOS)) return false;
      if (/medida\s+provis|medida provisional/i.test(ln) && !active.has(TOGGLE_ID_AUTO_MEDIDA)) return false;
    }
    return true;
  });
}

export function stripAutoOptionalNumeralsFromPlainIfNoToggleMarkers(
  text: string,
  defs: DocumentTemplateToggleDef[] | undefined,
  state: Record<string, boolean> | undefined,
): string {
  if (!defs?.length || !text.trim()) return text;
  const active = buildActiveToggleIds(defs, state);
  let lines = text.split('\n');

  if (!plainTextHasBuiltinToggleMarkers(text)) {
    if (!active.has(TOGGLE_ID_AUTO_VINCULADOS)) {
      lines = stripNumeralBlock(lines, 3, /VINCUL|vinculaci|VINCULACI/i);
    }
    if (!active.has(TOGGLE_ID_AUTO_MEDIDA)) {
      lines = stripNumeralBlock(lines, 4, /medida\s+provis|PROVIS|ordenar\s+medida|medida provisional/i);
    }
    lines = stripOrphanOptionalHintLines(lines, active);
  }

  return lines.join('\n');
}
