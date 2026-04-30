import React, { createContext, useContext, useMemo } from 'react';
import type { UserProfile } from '../types';
import { DEFAULT_DEMO_COURT_ID } from '../lib/default-court';

export type SessionCourtContextValue = {
  /** `court_id` del perfil autenticado; fallback solo si falta en BD. */
  courtId: string;
  profile: UserProfile | null;
};

const SessionCourtContext = createContext<SessionCourtContextValue | null>(null);

export function SessionCourtProvider({
  profile,
  children,
}: {
  profile: UserProfile | null;
  children: React.ReactNode;
}) {
  const value = useMemo<SessionCourtContextValue>(() => {
    const raw = profile?.courtId?.trim();
    const courtId = raw && raw.length > 0 ? raw : DEFAULT_DEMO_COURT_ID;
    return { courtId, profile };
  }, [profile]);

  return <SessionCourtContext.Provider value={value}>{children}</SessionCourtContext.Provider>;
}

export function useSessionCourt(): SessionCourtContextValue {
  const ctx = useContext(SessionCourtContext);
  if (!ctx) {
    throw new Error('useSessionCourt debe usarse dentro de Shell (usuario autenticado y SessionCourtProvider).');
  }
  return ctx;
}
