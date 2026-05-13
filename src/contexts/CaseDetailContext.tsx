import React, { createContext, useContext } from 'react';
import type { Case, Document as CaseDoc, UserProfile } from '../types';
import type { UserRole } from '../types';

export type CaseDetailExpedienteTab =
  | 'sintesis'
  | 'expediente'
  | 'revision_word'
  | 'actuaciones'
  | 'historial'
  | 'documentos'
  | 'incidente_desacato';

export type CaseDetailRefetch = {
  refetchCase: () => Promise<void>;
  refetchDocs: () => Promise<void>;
  refetchActions: () => Promise<void>;
  refetchAudit: () => Promise<void>;
};

export type CaseDetailPermissions = {
  role: UserRole | null;
};

export type CaseDetailContextValue = {
  caseId: string;
  caseItem: Case;
  courtId: string;
  profile: UserProfile | null;
  docs: CaseDoc[];
  refetch: CaseDetailRefetch;
  permisos: CaseDetailPermissions;
  setActiveTab: (tab: CaseDetailExpedienteTab) => void;
};

const CaseDetailContext = createContext<CaseDetailContextValue | null>(null);

export function CaseDetailProvider({
  value,
  children,
}: {
  value: CaseDetailContextValue;
  children: React.ReactNode;
}) {
  return <CaseDetailContext.Provider value={value}>{children}</CaseDetailContext.Provider>;
}

export function useCaseDetail(): CaseDetailContextValue {
  const v = useContext(CaseDetailContext);
  if (!v) throw new Error('useCaseDetail debe usarse dentro de CaseDetailProvider');
  return v;
}
