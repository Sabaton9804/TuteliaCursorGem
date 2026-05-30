import type { SustanciadorAssignmentMode } from '../types';
import type { ExpedienteAssignee } from './court-staff-types';
import { defaultSustanciadorForCase } from './court-staff-assignees';
import { demoSustanciadores } from './court-staff-demo-seed';
import { getCachedSustanciadores } from './court-staff-cache';

function resolveSustanciadoresList(explicit?: readonly ExpedienteAssignee[]): readonly ExpedienteAssignee[] {
  if (explicit?.length) return explicit;
  const cached = getCachedSustanciadores();
  if (cached.length) return cached;
  return demoSustanciadores();
}

function pickFromPool(index: number, pool: readonly ExpedienteAssignee[]): ExpedienteAssignee {
  if (!pool.length) {
    return {
      id: 'unassigned',
      initials: '—',
      name: 'Sin asignar',
      ring: 'ring-slate-200',
      bg: 'bg-slate-50',
      text: 'text-slate-500',
    };
  }
  const normalized = ((index % pool.length) + pool.length) % pool.length;
  return pool[normalized] ?? pool[0];
}

/** Texto corto para listas y desplegables (legible de un vistazo). */
export const SUSTANCIADOR_ASSIGNMENT_MODE_SHORT: Record<SustanciadorAssignmentMode, string> = {
  manual_unassigned: 'Yo elijo al abrir cada expediente',
  hash_stable: 'Automático: reparto equilibrado por expediente',
  radicado_parity: 'Automático: último número del radicado (par o impar)',
  alternating: 'Automático: turnos, uno tras otro al radicar',
};

export function sustanciadorAssignmentModeAudit(
  mode: SustanciadorAssignmentMode,
  sustanciadores?: readonly ExpedienteAssignee[],
): string {
  const pool = resolveSustanciadoresList(sustanciadores);
  const s0 = pool[0]?.name ?? 'Sustanciador 1';
  const s1 = pool[1]?.name ?? pool[0]?.name ?? 'Sustanciador 2';
  const map: Record<SustanciadorAssignmentMode, string> = {
    hash_stable: 'Hash estable por expediente (mismo criterio que antes, persistido al radicar)',
    radicado_parity: `Último dígito del radicado: par (0,2,4,6,8) → ${s0}; impar (1,3,5,7,9) → ${s1}`,
    alternating:
      pool.length >= 2
        ? `Una y una: alterna entre ${s0} y ${s1} en cada radicación (cursor en el juzgado)`
        : `Una y una: asigna a ${s0} (único sustanciador registrado en el despacho)`,
    manual_unassigned: 'Manual: sin asignar al radicar (se elige en el expediente)',
  };
  return map[mode];
}

/** @deprecated Preferir sustanciadorAssignmentModeAudit(sustanciadores) */
export const SUSTANCIADOR_ASSIGNMENT_MODE_AUDIT: Record<SustanciadorAssignmentMode, string> = {
  hash_stable: sustanciadorAssignmentModeAudit('hash_stable'),
  radicado_parity: sustanciadorAssignmentModeAudit('radicado_parity'),
  alternating: sustanciadorAssignmentModeAudit('alternating'),
  manual_unassigned: sustanciadorAssignmentModeAudit('manual_unassigned'),
};

/** @deprecated Preferir SHORT en UI y sustanciadorAssignmentModeAudit en logs. */
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

/** Par → pool[0], impar → pool[1] (o hash si un solo sustanciador). */
export function pickSustanciadorByRadicadoParity(
  radicado: string,
  fallbackSeed: string,
  sustanciadores?: readonly ExpedienteAssignee[],
): ExpedienteAssignee {
  const pool = resolveSustanciadoresList(sustanciadores);
  if (pool.length <= 1) {
    return pool[0] ?? defaultSustanciadorForCase(fallbackSeed, pool);
  }
  const digits = radicado.replace(/\D/g, '');
  if (!digits) return defaultSustanciadorForCase(fallbackSeed, pool);
  const last = Number(digits[digits.length - 1]);
  return pickFromPool(Number.isNaN(last) ? 0 : last % 2, pool);
}

export function computeInitialAssignedTo(params: {
  mode: SustanciadorAssignmentMode;
  radicado: string;
  caseId: string;
  rrCursor: number;
  sustanciadores?: readonly ExpedienteAssignee[];
}): { assignedTo: string | null; nextRrCursor: number } {
  const { mode, radicado, caseId, rrCursor, sustanciadores } = params;
  const pool = resolveSustanciadoresList(sustanciadores);
  const mod = Math.max(1, pool.length);
  const normalizedRr = Number.isFinite(rrCursor) ? Math.abs(Math.trunc(rrCursor)) % mod : 0;

  switch (mode) {
    case 'manual_unassigned':
      return { assignedTo: null, nextRrCursor: normalizedRr };
    case 'hash_stable':
      return {
        assignedTo: defaultSustanciadorForCase(caseId, pool).name,
        nextRrCursor: normalizedRr,
      };
    case 'radicado_parity':
      return {
        assignedTo: pickSustanciadorByRadicadoParity(radicado, caseId, pool).name,
        nextRrCursor: normalizedRr,
      };
    case 'alternating': {
      const pick = pickFromPool(normalizedRr, pool);
      return {
        assignedTo: pick.name,
        nextRrCursor: (normalizedRr + 1) % mod,
      };
    }
    default:
      return {
        assignedTo: defaultSustanciadorForCase(caseId, pool).name,
        nextRrCursor: normalizedRr,
      };
  }
}
