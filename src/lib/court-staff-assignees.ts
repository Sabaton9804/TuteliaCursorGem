import type { SustanciadorAssignmentMode, UserRole } from '../types';

/**
 * Personal del despacho (coincide con scripts/seed-court-users.mts).
 * Sustanciadores: reparto por defecto cuando `cases.assigned_to` está vacío.
 */
export interface ExpedienteAssignee {
  id: string;
  initials: string;
  name: string;
  ring: string;
  bg: string;
  text: string;
  /** Correos seed para coincidir si `assigned_to` guarda email. */
  emails?: readonly string[];
  /** Cargo formal en el organigrama (Equipo de trabajo / seed). */
  courtRole?: UserRole;
}

export const DESPACHO_STAFF: readonly ExpedienteAssignee[] = [
  {
    id: 'gloria-montero',
    initials: 'GM',
    name: 'Gloria Patricia Montero Cabas',
    ring: 'ring-violet-200',
    bg: 'bg-violet-100',
    text: 'text-violet-900',
    emails: ['gloria.montero.cabas@tutelia-despacho.seed'],
    courtRole: 'judge',
  },
  {
    id: 'camilo-marroquin',
    initials: 'CM',
    name: 'Camilo Andres Marroquín Hernandez',
    ring: 'ring-blue-200',
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    emails: ['camilo.marroquin.hernandez@tutelia-despacho.seed'],
    courtRole: 'clerk',
  },
  {
    id: 'diego-guarin',
    initials: 'DG',
    name: 'Diego Enrique Guarin Vega',
    ring: 'ring-emerald-200',
    bg: 'bg-emerald-100',
    text: 'text-emerald-900',
    emails: ['diego.guarin.vega@tutelia-despacho.seed'],
    courtRole: 'sustanciador',
  },
  {
    id: 'myriam-fonseca',
    initials: 'MF',
    name: 'Myriam Francesa Fonseca Alvarez',
    ring: 'ring-teal-200',
    bg: 'bg-teal-100',
    text: 'text-teal-900',
    emails: ['myriam.fonseca.alvarez@tutelia-despacho.seed'],
    courtRole: 'sustanciador',
  },
  {
    id: 'yeiner-osorio',
    initials: 'YF',
    name: 'Yeiner Giovanny Osorio Florez',
    ring: 'ring-amber-200',
    bg: 'bg-amber-100',
    text: 'text-amber-900',
    emails: ['yeiner.osorio.florez@tutelia-despacho.seed'],
    courtRole: 'escribiente',
  },
  {
    id: 'lina-martinez',
    initials: 'LM',
    name: 'Lina Paola Martinez Orjuela',
    ring: 'ring-orange-200',
    bg: 'bg-orange-100',
    text: 'text-orange-900',
    emails: ['lina.martinez.orjuela@tutelia-despacho.seed'],
    courtRole: 'escribiente',
  },
  {
    id: 'edisson-cantor',
    initials: 'EC',
    name: 'Edisson James Cantor Burgos',
    ring: 'ring-slate-300',
    bg: 'bg-slate-200',
    text: 'text-slate-800',
    emails: ['edisson.cantor.burgos@tutelia-despacho.seed'],
    courtRole: 'asistente_judicial',
  },
] as const;

/** Solo sustanciadores: reparto por defecto y filtro «Sustanciador» en vistas. */
export const SUSTANCIADORES: readonly ExpedienteAssignee[] = DESPACHO_STAFF.filter((p) =>
  ['diego-guarin', 'myriam-fonseca'].includes(p.id)
);

export function normalizeStaffKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** «Mis asignadas»: el expediente tiene `assigned_to` con el mismo nombre que el perfil (normalizado). */
export function assignedToMatchesProfile(
  assignedTo: string | undefined,
  profileName: string | undefined
): boolean {
  const a = assignedTo?.trim();
  const p = profileName?.trim();
  if (!a || !p) return false;
  return normalizeStaffKey(a) === normalizeStaffKey(p);
}

function matchesStaff(row: ExpedienteAssignee, raw: string): boolean {
  const key = normalizeStaffKey(raw);
  if (!key) return false;
  if (normalizeStaffKey(row.name) === key) return true;
  for (const em of row.emails || []) {
    if (normalizeStaffKey(em) === key) return true;
  }
  if (row.initials.toLowerCase() === key.toLowerCase()) return true;
  return false;
}

export function findStaffByAssignedValue(raw: string): ExpedienteAssignee | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  return DESPACHO_STAFF.find((p) => matchesStaff(p, t));
}

/** Texto en `assigned_to` sin coincidir al catálogo: mostrar tal cual con iniciales derivadas. */
export function buildSyntheticAssignee(label: string): ExpedienteAssignee {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  let initials = '—';
  if (parts.length >= 2) {
    initials = `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase() || '—';
  } else if (parts.length === 1 && parts[0].length >= 2) {
    initials = parts[0].slice(0, 2).toUpperCase();
  }
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return {
    id: `asignado-${slug || 'desconocido'}`,
    initials,
    name: label.trim(),
    ring: 'ring-slate-200',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
  };
}

function hashPick<T>(seed: string, items: readonly T[]): T {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return items[h % items.length];
}

/** Cuando no hay `assigned_to`, reparto estable entre los dos sustanciadores. */
export function defaultSustanciadorForCase(caseId: string): ExpedienteAssignee {
  return hashPick(caseId, SUSTANCIADORES);
}

const UNASSIGNED_PLACEHOLDER: ExpedienteAssignee = {
  id: 'unassigned',
  initials: '—',
  name: 'Sin asignar',
  ring: 'ring-slate-200',
  bg: 'bg-slate-50',
  text: 'text-slate-500',
};

/**
 * @param courtAssignmentMode Si el juzgado está en `manual_unassigned` y no hay `assigned_to`,
 *        se muestra «Sin asignar» en lugar del reparto simulado por hash.
 */
export function resolveAssigneeForCase(
  assignedTo: string | undefined,
  caseId: string,
  courtAssignmentMode?: SustanciadorAssignmentMode | null
): ExpedienteAssignee {
  const raw = assignedTo?.trim();
  if (raw) {
    const hit = findStaffByAssignedValue(raw);
    if (hit) return hit;
    return buildSyntheticAssignee(raw);
  }
  if (courtAssignmentMode === 'manual_unassigned') return UNASSIGNED_PLACEHOLDER;
  return defaultSustanciadorForCase(caseId);
}
