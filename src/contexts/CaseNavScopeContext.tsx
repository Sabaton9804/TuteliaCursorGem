import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { CaseNavScope } from '../lib/case-process-scope';

type CaseNavScopeContextValue = {
  scope: CaseNavScope | null;
  setScope: (scope: CaseNavScope | null) => void;
};

const CaseNavScopeContext = createContext<CaseNavScopeContextValue | null>(null);

export function CaseNavScopeProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [scope, setScopeState] = useState<CaseNavScope | null>(null);

  useEffect(() => {
    if (!location.pathname.startsWith('/case/')) {
      setScopeState(null);
    }
  }, [location.pathname]);

  const setScope = useCallback((next: CaseNavScope | null) => {
    setScopeState(next);
  }, []);

  const value = useMemo(() => ({ scope, setScope }), [scope, setScope]);

  return <CaseNavScopeContext.Provider value={value}>{children}</CaseNavScopeContext.Provider>;
}

export function useCaseNavScope(): CaseNavScope | null {
  return useContext(CaseNavScopeContext)?.scope ?? null;
}

export function useSetCaseNavScope(): (scope: CaseNavScope | null) => void {
  const ctx = useContext(CaseNavScopeContext);
  return ctx?.setScope ?? (() => {});
}
