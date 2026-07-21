import React from 'react';
import { CaseDespachoDocumentosPanel } from './CaseDespachoDocumentosPanel';
import { CaseDespachoProvidenciasPanel } from './CaseDespachoProvidenciasPanel';
import { CaseNotificacionesPanel } from './CaseNotificacionesPanel';
import { useCaseDetail } from '../../contexts/CaseDetailContext';
import { useCaseStages } from '../../hooks/useCaseStages';
import {
  supportsContestacionWorkflow,
  supportsNotificacionFalloWorkflow,
} from '../../lib/sgde-case-scope';

export type CaseDespachoPanelProps = {
  onAfterEnviarRevision: () => void;
};

/** Pestaña «Generar documentos»: informe, auto admisorio, autos de trámite, sentencia, oficios. */
export function CaseDespachoPanel({ onAfterEnviarRevision }: CaseDespachoPanelProps) {
  const { caseItem, docs, refetch, profile, setActiveTab } = useCaseDetail();

  const stages = useCaseStages({
    caseId: caseItem.id,
    courtId: caseItem.courtId,
    radicado: caseItem.radicado,
    caseType: caseItem.caseType,
    caseAssignedTo: caseItem.assignedTo,
  });

  const onUpdated = async () => {
    await Promise.all([refetch.refetchCase(), refetch.refetchDocs()]);
  };

  const onAfterRegistrarInforme = async () => {
    await onUpdated();
    setActiveTab('expediente');
    // Segunda pasada: el INSERT a veces llega al listado un instante después del UPDATE del caso.
    await new Promise((r) => setTimeout(r, 250));
    await refetch.refetchDocs();
  };

  const onStageAdvanced = () => {
    void stages.refetch();
    void refetch.refetchActions();
  };

  const showNotificaciones =
    supportsContestacionWorkflow(caseItem.caseType) || supportsNotificacionFalloWorkflow(caseItem.caseType);
  const falloOnly =
    !supportsContestacionWorkflow(caseItem.caseType) && supportsNotificacionFalloWorkflow(caseItem.caseType);

  return (
    <div className="space-y-6">
      <CaseDespachoDocumentosPanel
        caseItem={caseItem}
        caseId={caseItem.id}
        docs={docs}
        onCaseUpdated={onUpdated}
        onAfterRegistrarInforme={onAfterRegistrarInforme}
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
      {showNotificaciones ? (
        <CaseNotificacionesPanel
          caseItem={caseItem}
          caseId={caseItem.id}
          docs={docs}
          openStageCode={stages.openRow?.stageCode}
          falloOnly={falloOnly}
          onUpdated={onUpdated}
          onStageAdvanced={onStageAdvanced}
        />
      ) : null}
    </div>
  );
}
