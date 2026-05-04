import type { DocumentTemplateTipo, DocumentTemplateToggleDef } from '../types';

/** IDs fijos para que puedan enlazarse desde el documento TipTap sin cambiar al guardar. */
export const TOGGLE_ID_AUTO_VINCULADOS = 'a2000001-0001-4001-8001-000000000001';
export const TOGGLE_ID_AUTO_MEDIDA = 'a2000001-0001-4001-8001-000000000002';

/** Marcadores legibles en el cuerpo (como pastillas en el editor), no UUID. */
export const MARKER_VINCULADOS = 'BLOQUE_VINCULADOS';
export const MARKER_MEDIDA_PROVISIONAL = 'BLOQUE_MEDIDA_PROVISIONAL';

/** Opciones clásicas del auto admisorio (vinculados + medida provisional). */
export const DEFAULT_TOGGLE_DEFS_AUTO_ADMISORIO: DocumentTemplateToggleDef[] = [
  {
    id: TOGGLE_ID_AUTO_VINCULADOS,
    label: 'Incluir vinculación de terceros',
    description: 'Dos numerales: lista y notificación',
    defaultOn: false,
    blockContent: '',
    documentMarker: MARKER_VINCULADOS,
  },
  {
    id: TOGGLE_ID_AUTO_MEDIDA,
    label: 'Incluir medida provisional',
    description: 'Un numeral con bloque dinámico',
    defaultOn: false,
    blockContent: '',
    documentMarker: MARKER_MEDIDA_PROVISIONAL,
  },
];

/** IDs que siempre forman parte del auto admisorio (no se pueden eliminar en el editor). */
export const BUILTIN_AUTO_ADMISORIO_TOGGLE_IDS = new Set<string>([
  TOGGLE_ID_AUTO_VINCULADOS,
  TOGGLE_ID_AUTO_MEDIDA,
]);

export function isBuiltinAutoAdmisorioToggle(id: string): boolean {
  return BUILTIN_AUTO_ADMISORIO_TOGGLE_IDS.has(id);
}

function normalizeToggleDefFromBd(d: DocumentTemplateToggleDef): DocumentTemplateToggleDef {
  let dm = String(d.documentMarker ?? '').trim();
  if (!dm) {
    if (d.id === TOGGLE_ID_AUTO_VINCULADOS) dm = MARKER_VINCULADOS;
    else if (d.id === TOGGLE_ID_AUTO_MEDIDA) dm = MARKER_MEDIDA_PROVISIONAL;
  }
  return {
    ...d,
    blockContent: d.blockContent ?? '',
    documentMarker: dm,
  };
}

/**
 * - Auto admisorio: siempre incluye vinculados + medida provisional (IDs fijos); los datos en BD
 *   fusionan por `id` y las opciones extra se añaden después.
 * - Otros tipos: solo lo guardado en BD (vacío = sin opciones).
 */
export function defaultToggleDefsForPlantilla(
  tipo: DocumentTemplateTipo,
  desdeBd: DocumentTemplateToggleDef[] | undefined,
): DocumentTemplateToggleDef[] {
  if (tipo !== 'auto_admisorio') {
    if (!desdeBd?.length) return [];
    return desdeBd.map(normalizeToggleDefFromBd);
  }

  const classics = DEFAULT_TOGGLE_DEFS_AUTO_ADMISORIO.map((d) => ({ ...d }));
  if (!desdeBd?.length) return classics;

  const bdById = new Map(desdeBd.map((d) => [d.id, normalizeToggleDefFromBd(d)]));
  const merged: DocumentTemplateToggleDef[] = [];

  for (const c of classics) {
    const fromBd = bdById.get(c.id);
    merged.push(
      fromBd
        ? {
            ...c,
            ...fromBd,
            id: c.id,
            documentMarker: (fromBd.documentMarker ?? '').trim() || c.documentMarker,
          }
        : { ...c },
    );
  }

  for (const d of desdeBd) {
    if (!BUILTIN_AUTO_ADMISORIO_TOGGLE_IDS.has(d.id)) {
      merged.push(normalizeToggleDefFromBd(d));
    }
  }

  return merged;
}
