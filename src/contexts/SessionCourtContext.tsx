/**
 * Compatibilidad legacy — preferir `useTenant()` en código nuevo.
 * `courtId` = despacho efectivo (viewAs o activo).
 */
import { useTenant } from './TenantContext';
import type { UserProfile } from '../types';

export type SessionCourtContextValue = {
  courtId: string;
  profile: UserProfile | null;
};

export { TenantProvider as SessionCourtProvider } from './TenantContext';

export function useSessionCourt(): SessionCourtContextValue {
  const { courtId, profile } = useTenant();
  return { courtId, profile };
}
