import type { SustanciadorAssignmentMode } from '../types';
import { getCachedCourtStaff, getCachedSustanciadores } from './court-staff-cache';
import type { ExpedienteAssignee } from './court-staff-types';
import { DEMO_DESPACHO_STAFF } from './court-staff-demo-seed';

export type { ExpedienteAssignee } from './court-staff-types';
export { DEMO_DESPACHO_STAFF } from './court-staff-demo-seed';

/** @deprecated Usar `useCourtOperational().staff` o `getCachedCourtStaff()`. */
export const DESPACHO_STAFF = DEMO_DESPACHO_STAFF;

function defaultSustanciadoresList(staff?: readonly ExpedienteAssignee[]): readonly ExpedienteAssignee[] {
  const pool = staff ?? DEMO_DESPACHO_STAFF;
  const sus = pool.filter((p) => p.courtRole === 'sustanciador');
  if (sus.length) return sus;
  return DEMO_DESPACHO_STAFF.filter((p) => ['diego-guarin', 'myriam-fonseca'].includes(p.id));
}

/** @deprecated Usar lista dinámica del despacho vía contexto o caché. */
export const SUSTANCIADORES: readonly ExpedienteAssignee[] = defaultSustanciadoresList(DEMO_DESPACHO_STAFF);

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

export function findStaffByAssignedValue(
  raw: string,
  staff?: readonly ExpedienteAssignee[],
): ExpedienteAssignee | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const pool = staff ?? getCachedCourtStaff();
  return pool.find((p) => matchesStaff(p, t));
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

/** Cuando no hay `assigned_to`, reparto estable entre sustanciadores del despacho. */
export function defaultSustanciadorForCase(
  caseId: string,
  sustanciadores?: readonly ExpedienteAssignee[],
): ExpedienteAssignee {
  const pool = defaultSustanciadoresList(sustanciadores);
  if (!pool.length) return UNASSIGNED_PLACEHOLDER;
  return hashPick(caseId, pool);
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
  courtAssignmentMode?: SustanciadorAssignmentMode | null,
  opts?: {
    staff?: readonly ExpedienteAssignee[];
    sustanciadores?: readonly ExpedienteAssignee[];
  },
): ExpedienteAssignee {
  const staff = opts?.staff ?? getCachedCourtStaff();
  const sustanciadores = opts?.sustanciadores ?? getCachedSustanciadores();
  const raw = assignedTo?.trim();
  if (raw) {
    const hit = findStaffByAssignedValue(raw, staff);
    if (hit) return hit;
    return buildSyntheticAssignee(raw);
  }
  if (courtAssignmentMode === 'manual_unassigned') return UNASSIGNED_PLACEHOLDER;
  return defaultSustanciadorForCase(caseId, sustanciadores);
}
