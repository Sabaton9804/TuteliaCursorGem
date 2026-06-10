import React from 'react';
import { CaseDespachoDocumentosPanel } from './CaseDespachoDocumentosPanel';
import { CaseNotificacionesPanel } from './CaseNotificacionesPanel';
import { useCaseDetail } from '../../contexts/CaseDetailContext';

export type CaseDespachoPanelProps = {
  onAfterEnviarRevision: () => void;
};

/** Pestaña «Generar documentos»: informe, auto, oficios de notificación. */
export function CaseDespachoPanel({ onAfterEnviarRevision }: CaseDespachoPanelProps) {
  const { caseItem, docs, refetch, profile } = useCaseDetail();

  const onUpdated = () => {
    void refetch.refetchCase();
    void refetch.refetchDocs();
  };

  return (
    <div className="space-y-6">
      <CaseDespachoDocumentosPanel
        caseItem={caseItem}
        caseId={caseItem.id}
        docs={docs}
        onCaseUpdated={onUpdated}
        onAfterEnviarRevision={onAfterEnviarRevision}
        revisionActorDisplayName={profile?.name?.trim() || profile?.email?.trim() || undefined}
      />
      {caseItem.caseType === 'tutela_primera' ? (
        <CaseNotificacionesPanel caseItem={caseItem} caseId={caseItem.id} docs={docs} onUpdated={onUpdated} />
      ) : null}
    </div>
  );
}
