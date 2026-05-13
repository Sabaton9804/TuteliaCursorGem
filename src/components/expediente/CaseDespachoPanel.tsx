import React from 'react';
import { CaseDespachoDocumentosPanel } from './CaseDespachoDocumentosPanel';
import { useCaseDetail } from '../../contexts/CaseDetailContext';

export type CaseDespachoPanelProps = {
  onAfterEnviarRevision: () => void;
};

/** Pestaña «Generar documentos»: informe de secretaría y auto del despacho. */
export function CaseDespachoPanel({ onAfterEnviarRevision }: CaseDespachoPanelProps) {
  const { caseItem, docs, refetch, profile } = useCaseDetail();

  return (
    <CaseDespachoDocumentosPanel
      caseItem={caseItem}
      caseId={caseItem.id}
      docs={docs}
      onCaseUpdated={() => {
        void refetch.refetchCase();
        void refetch.refetchDocs();
      }}
      onAfterEnviarRevision={onAfterEnviarRevision}
      revisionActorDisplayName={profile?.name?.trim() || profile?.email?.trim() || undefined}
    />
  );
}
