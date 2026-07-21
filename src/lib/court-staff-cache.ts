import type { ExpedienteAssignee } from './court-staff-types';
import { DEMO_DESPACHO_STAFF, demoSustanciadores } from './court-staff-demo-seed';
import type { UserRole } from '../types';

/** Caché sincronizada para plantillas y tablero (actualizada por CourtOperationalProvider). */
let cachedCourtId: string | null = null;
let cachedStaff: ExpedienteAssignee[] = [...DEMO_DESPACHO_STAFF];
let cachedSustanciadores: ExpedienteAssignee[] = demoSustanciadores();

export function setCourtStaffCache(
  courtId: string,
  staff: readonly ExpedienteAssignee[],
  sustanciadores: readonly ExpedienteAssignee[],
): void {
  cachedCourtId = courtId;
  cachedStaff = staff.length ? [...staff] : [...DEMO_DESPACHO_STAFF];
  cachedSustanciadores = sustanciadores.length > 0 ? [...sustanciadores] : demoSustanciadores();
}

export function getCachedCourtStaff(_courtId?: string): readonly ExpedienteAssignee[] {
  return cachedStaff;
}

export function getCachedSustanciadores(_courtId?: string): readonly ExpedienteAssignee[] {
  return cachedSustanciadores;
}

function isBotPlaceholderName(name: string): boolean {
  return /^bot(\s|$)/i.test(name.trim());
}

/**
 * Nombre del organigrama por rol (plantillas / firma).
 * Si hay varios perfiles con el mismo rol, prioriza personas reales sobre cuentas «Bot …»
 * y, si coincide, el nombre del seed del despacho.
 */
export function getCachedNameByRole(role: UserRole, courtId?: string): string {
  if (courtId && courtId !== cachedCourtId) return '';
  const hits = cachedStaff.filter((p) => p.courtRole === role);
  if (!hits.length) return '';
  const real = hits.filter((p) => !isBotPlaceholderName(p.name));
  const pool = real.length ? real : hits;
  const demoName = DEMO_DESPACHO_STAFF.find((d) => d.courtRole === role)?.name?.trim();
  if (demoName) {
    const demoKey = demoName
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const demoHit = pool.find((p) => {
      const k = p.name
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      return k === demoKey;
    });
    if (demoHit?.name?.trim()) return demoHit.name.trim();
  }
  return pool[0]?.name?.trim() ?? '';
}

export function getCachedCourtId(): string | null {
  return cachedCourtId;
}
