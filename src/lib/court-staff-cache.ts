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

export function getCachedNameByRole(role: UserRole, courtId?: string): string {
  if (courtId && courtId !== cachedCourtId) return '';
  const hit = cachedStaff.find((p) => p.courtRole === role);
  return hit?.name?.trim() ?? '';
}

export function getCachedCourtId(): string | null {
  return cachedCourtId;
}
