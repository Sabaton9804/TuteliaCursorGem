import type { SustanciadorAssignmentMode } from '../types';
import type { ExpedienteAssignee } from './court-staff-assignees';
import { defaultSustanciadorForCase, SUSTANCIADORES } from './court-staff-assignees';

const S0 = SUSTANCIADORES[0]?.name ?? 'Sustanciador 1';
const S1 = SUSTANCIADORES[1]?.name ?? 'Sustanciador 2';

/** Texto corto para listas y desplegables (legible de un vistazo). */
export const SUSTANCIADOR_ASSIGNMENT_MODE_SHORT: Record<SustanciadorAssignmentMode, string> = {
  manual_unassigned: 'Yo elijo al abrir cada expediente',
  hash_stable: 'Automático: reparto equilibrado por expediente',
  radicado_parity: 'Automático: último número del radicado (par o impar)',
  alternating: 'Automático: turnos, uno tras otro al radicar',
};

/** Texto detallado para auditoría (case_actions, registros). */
export const SUSTANCIADOR_ASSIGNMENT_MODE_AUDIT: Record<SustanciadorAssignmentMode, string> = {
  hash_stable: 'Hash estable por expediente (mismo criterio que antes, persistido al radicar)',
  radicado_parity: `Último dígito del radicado: par (0,2,4,6,8) → ${S0}; impar (1,3,5,7,9) → ${S1}`,
  alternating: `Una y una: alterna entre ${S0} y ${S1} en cada radicación (cursor en el juzgado)`,
  manual_unassigned: 'Manual: sin asignar al radicar (se elige en el expediente)',
};

/** @deprecated Preferir SHORT en UI y AUDIT en logs; se mantiene alias por compatibilidad. */
export const SUSTANCIADOR_ASSIGNMENT_MODE_LABELS = SUSTANCIADOR_ASSIGNMENT_MODE_AUDIT;

export function parseSustanciadorAssignmentMode(raw: unknown): SustanciadorAssignmentMode {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (
    s === 'hash_stable' ||
    s === 'radicado_parity' ||
    s === 'alternating' ||
    s === 'manual_unassigned'
  ) {
    return s;
  }
  return 'manual_unassigned';
}

/** Último dígito numérico del radicado: par → sustanciador[0], impar → [1]. Sin dígitos: hash por `fallbackSeed`. */
export function pickSustanciadorByRadicadoParity(
  radicado: string,
  fallbackSeed: string
): ExpedienteAssignee {
  const digits = radicado.replace(/\D/g, '');
  if (!digits) return defaultSustanciadorForCase(fallbackSeed);
  const last = Number(digits[digits.length - 1]);
  return SUSTANCIADORES[last % 2] ?? SUSTANCIADORES[0];
}

export function computeInitialAssignedTo(params: {
  mode: SustanciadorAssignmentMode;
  radicado: string;
  caseId: string;
  rrCursor: number;
}): { assignedTo: string | null; nextRrCursor: number } {
  const { mode, radicado, caseId, rrCursor } = params;
  const normalizedRr = Number.isFinite(rrCursor) ? Math.abs(Math.trunc(rrCursor)) % 2 : 0;

  switch (mode) {
    case 'manual_unassigned':
      return { assignedTo: null, nextRrCursor: normalizedRr };
    case 'hash_stable':
      return {
        assignedTo: defaultSustanciadorForCase(caseId).name,
        nextRrCursor: normalizedRr,
      };
    case 'radicado_parity':
      return {
        assignedTo: pickSustanciadorByRadicadoParity(radicado, caseId).name,
        nextRrCursor: normalizedRr,
      };
    case 'alternating': {
      const pick = SUSTANCIADORES[normalizedRr] ?? SUSTANCIADORES[0];
      return {
        assignedTo: pick.name,
        nextRrCursor: normalizedRr === 0 ? 1 : 0,
      };
    }
    default:
      return {
        assignedTo: defaultSustanciadorForCase(caseId).name,
        nextRrCursor: normalizedRr,
      };
  }
}
