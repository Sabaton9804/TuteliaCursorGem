import type { UserProfile } from '../types';

/** Tablas PostgREST con columna `court_id` (doble defensa app + RLS). */
export const COURT_SCOPED_TABLES = new Set([
  'cases',
  'precedents',
  'document_templates',
  'workflow_tasks',
  'case_tasks',
  'case_stages',
  'template_variables',
  'incident_desacato',
  'user_notifications',
  'court_mailboxes',
  'outlook_message_reviews',
]);

export type TenantScope = {
  profile: UserProfile | null;
  activeCourtId: string;
  effectiveCourtId: string | null;
  viewAsCourtId: string | null;
  /** Admin nacional (todos los territorios). */
  isPlatformAdmin: boolean;
  /** Operador regional con territorios asignados. */
  isRegionalPlatformAdmin: boolean;
  /** Acceso a /plataforma (nacional o regional). */
  canAccessPlatformConsole: boolean;
  regionalTerritoryIds: string[];
  /** Operador consola sin viewAs: no ejecutar fetches operativos amplios. */
  needsViewAsSelection: boolean;
};

export function resolveTenantScope(input: {
  profile: UserProfile | null;
  activeCourtId: string;
  viewAsCourtId: string | null;
  isPlatformAdmin: boolean;
  isRegionalPlatformAdmin: boolean;
  regionalTerritoryIds: string[];
}): TenantScope {
  const {
    profile,
    activeCourtId,
    viewAsCourtId,
    isPlatformAdmin,
    isRegionalPlatformAdmin,
    regionalTerritoryIds,
  } = input;
  const canAccessPlatformConsole = isPlatformAdmin || isRegionalPlatformAdmin;
  const effectiveCourtId = viewAsCourtId ?? (canAccessPlatformConsole ? null : activeCourtId);
  return {
    profile,
    activeCourtId,
    effectiveCourtId,
    viewAsCourtId,
    isPlatformAdmin,
    isRegionalPlatformAdmin,
    canAccessPlatformConsole,
    regionalTerritoryIds,
    needsViewAsSelection: canAccessPlatformConsole && !viewAsCourtId,
  };
}

type EqQuery = {
  eq: (column: string, value: string) => EqQuery;
};

/** Filtra SELECT por despacho efectivo. Devuelve null si no hay scope (admin sin viewAs). */
export function scopeSelectQuery<T extends EqQuery>(query: T, scope: TenantScope, courtColumn = 'court_id'): T | null {
  if (scope.needsViewAsSelection) return null;
  const courtId = scope.effectiveCourtId ?? scope.activeCourtId;
  if (!courtId?.trim()) return null;
  return query.eq(courtColumn, courtId) as T;
}

export function scopeInsertPayload<T extends Record<string, unknown>>(
  payload: T,
  scope: TenantScope,
  courtColumn = 'court_id'
): T | null {
  if (scope.needsViewAsSelection) return null;
  const courtId = scope.effectiveCourtId ?? scope.activeCourtId;
  if (!courtId?.trim()) return null;
  return { ...payload, [courtColumn]: courtId };
}

/** courtId para queries: null si platform admin debe elegir despacho primero. */
export function operationalCourtIdForFetch(scope: TenantScope): string | null {
  if (scope.needsViewAsSelection) return null;
  return scope.effectiveCourtId ?? scope.activeCourtId ?? null;
}
