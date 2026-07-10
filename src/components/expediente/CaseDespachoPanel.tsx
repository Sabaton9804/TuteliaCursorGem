import React from 'react';
import { CaseDespachoDocumentosPanel } from './CaseDespachoDocumentosPanel';
import { CaseDespachoProvidenciasPanel } from './CaseDespachoProvidenciasPanel';
import { CaseNotificacionesPanel } from './CaseNotificacionesPanel';
import { useCaseDetail } from '../../contexts/CaseDetailContext';
import { supportsContestacionWorkflow } from '../../lib/sgde-case-scope';

export type CaseDespachoPanelProps = {
  onAfterEnviarRevision: () => void;
};

/** Pestaña «Generar documentos»: informe, auto admisorio, autos de trámite, sentencia, oficios. */
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
      <CaseDespachoProvidenciasPanel
        caseItem={caseItem}
        caseId={caseItem.id}
        docs={docs}
        onAfterEnviarRevision={onAfterEnviarRevision}
        revisionActorDisplayName={profile?.name?.trim() || profile?.email?.trim() || undefined}
      />
      {supportsContestacionWorkflow(caseItem.caseType) ? (
        <CaseNotificacionesPanel caseItem={caseItem} caseId={caseItem.id} docs={docs} onUpdated={onUpdated} />
      ) : null}
    </div>
  );
}
