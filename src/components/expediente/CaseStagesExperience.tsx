import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  ChevronRight,
  Loader2,
  PanelRightOpen,
  X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import { useCaseDetail } from '../../contexts/CaseDetailContext';
import { useCaseStages } from '../../hooks/useCaseStages';
import {
  stageLabelForCaseType,
  type CaseStageCode,
  pipelineForCaseType,
} from '../../lib/case-workflow-stages';
import {
  applyStageTransitionApelacionRecibida,
  applyStageTransitionImpugnacionRecibida,
  applyStageTransitionInadmisionRegistrada,
  applyStageTransitionContestacionCerrada,
  applyStageTransitionExpedienteRecibidoAlDespacho,
  applyStageTransitionIngresoDespachoParaSentencia,
  applyStageTransitionNotificacionAutoEnviada,
  applyStageTransitionNotificacionFalloEnviada,
  applyStageTransitionRechazoRegistrado,
  applyStageTransitionRemisionCorteRegistrada,
  applyStageTransitionRemisionSuperiorRegistrada,
  canEditStageEnteredAt,
  canManualManageCaseStages,
  manualStageEditEnteredAt,
  manualStageGoBack,
  manualStageSkipTo,
  runAutomaticStageChecksOnCaseLoad,
} from '../../lib/case-stages-service';
import {
  canRegistrarImpugnacionRecibida,
  canRegistrarApelacionRecibida,
  canRegistrarInadmision,
  canRegistrarNotificacionAutoEnviada,
  canRegistrarNotificacionFalloEnviada,
  canRegistrarRechazoDemanda,
  canRegistrarRemisionCorte,
  canRegistrarRemisionSuperior,
  stageActGateMessage,
} from '../../lib/case-stage-act-gates';
import { CaseContestacionChecklistPanel } from './CaseContestacionChecklistPanel';
import { canRegistrarHitosSecretaria, canRegistrarRamaAdmision } from '../../lib/role-capabilities';
import { isCivilCaseType } from '../../lib/process-product-scope';
import { getBranchTransitionsFromStage } from '../../lib/process-stage-transitions';
import { isCivilEjecutivoCaseType, supportsContestacionWorkflow } from '../../lib/sgde-case-scope';
import { startOfLocalDay } from '../../lib/business-days';
import { plazoFallarSnapshotForCase } from '../../lib/plazo-fallar-tutela';
import {
  businessDaysRemainingUntilSubDeadline,
  resolveSubStageDeadline,
  subStageDeadlineLabel,
} from '../../lib/case-stage-deadlines';

function formatStageDate(iso: string): string {
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return format(d, "d MMM yyyy HH:mm", { locale: es });
  } catch {
    return iso;
  }
}

export function CaseStagesExperience() {
  const { caseItem, courtId, profile, refetch, docs } = useCaseDetail();
  const caseId = caseItem.id;
  const radicado = caseItem.radicado;
  const caseType = caseItem.caseType;
  const assignedTo = caseItem.assignedTo;
  const role = profile?.role ?? null;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [fechaNotifAuto, setFechaNotifAuto] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [fechaNotifFallo, setFechaNotifFallo] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const stages = useCaseStages({
    caseId,
    courtId,
    radicado,
    caseType,
    caseAssignedTo: assignedTo,
  });

  const isCivil = isCivilCaseType(caseType ?? '');
  const isEjecutivo = caseType != null && isCivilEjecutivoCaseType(caseType);
  const stageLabel = (code: CaseStageCode) => stageLabelForCaseType(code, caseType ?? undefined);

  const pipeline = useMemo(() => pipelineForCaseType(caseType), [caseType]);

  const gateNotifAuto = useMemo(
    () => canRegistrarNotificacionAutoEnviada(caseType ?? 'tutela_primera', docs),
    [caseType, docs],
  );
  const gateNotifFallo = useMemo(
    () => canRegistrarNotificacionFalloEnviada(caseType ?? 'tutela_primera', docs),
    [caseType, docs],
  );
  const gateImpugnacion = useMemo(
    () => canRegistrarImpugnacionRecibida(caseType ?? 'tutela_primera', docs),
    [caseType, docs],
  );
  const gateRemisionSuperior = useMemo(
    () => canRegistrarRemisionSuperior(caseType ?? 'tutela_primera', docs),
    [caseType, docs],
  );
  const gateRemisionCorte = useMemo(
    () => canRegistrarRemisionCorte(caseType ?? 'tutela_primera', docs),
    [caseType, docs],
  );
  const gateApelacion = useMemo(
    () => canRegistrarApelacionRecibida(caseType ?? 'civil_ordinario', docs),
    [caseType, docs],
  );
  const gateInadmision = useMemo(
    () => canRegistrarInadmision(caseType ?? 'tutela_primera', docs),
    [caseType, docs],
  );
  const gateRechazo = useMemo(
    () => canRegistrarRechazoDemanda(caseType ?? 'tutela_primera', docs),
    [caseType, docs],
  );

  useEffect(() => {
    void runAutomaticStageChecksOnCaseLoad(supabase, {
      caseId,
      courtId,
      radicado,
      caseType: caseType ?? 'tutela_primera',
      caseAssignedTo: assignedTo,
      deadlineAt: caseItem.deadlineAt,
    }).then(() => void stages.refetch());
  }, [caseId, courtId, radicado, caseType, assignedTo, caseItem.deadlineAt, stages.refetch]);

  const openRow = stages.openRow;
  const badgeSecret = openRow?.responsibleRole === 'secretaria';

  const plazoFallar = useMemo(() => plazoFallarSnapshotForCase(caseItem), [caseItem]);

  const plazoEtapa = useMemo(() => {
    if (!openRow) return null;
    const label = subStageDeadlineLabel(openRow.stageCode, caseType);
    if (!label) return null;
    const end = resolveSubStageDeadline(openRow.stageCode, openRow.enteredAt, openRow.metadata, caseType);
    if (!end) return null;
    const remaining = businessDaysRemainingUntilSubDeadline(end);
    return { label, end, remaining };
  }, [openRow, caseType]);

  const handleRetroceder = useCallback(async () => {
    if (!openRow) return;
    const idx = pipeline.indexOf(openRow.stageCode);
    if (idx <= 0) return;
    const prevLabel = stageLabel(pipeline[idx - 1]!);
    if (
      !window.confirm(
        `¿Seguro que desea retroceder a ${prevLabel}? Esto reabrirá la etapa anterior.`,
      )
    )
      return;
    const motivo = window.prompt('Motivo del cambio (opcional)', 'Corrección administrativa') ?? '';
    setBusy(true);
    setLocalErr(null);
    try {
      await manualStageGoBack(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        motivo: motivo.trim() || 'Corrección administrativa',
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo retroceder.');
    } finally {
      setBusy(false);
    }
  }, [openRow, pipeline, caseId, courtId, radicado, caseType, assignedTo, stages.refetch, refetch]);

  const [skipPick, setSkipPick] = useState<CaseStageCode | ''>('');

  const handleSaltar = useCallback(async () => {
    if (!skipPick || !openRow) return;
    if (
      !window.confirm(
        `¿Seguro que desea saltar a ${stageLabel(skipPick)}? Las etapas intermedias se marcarán como omitidas.`,
      )
    )
      return;
    const motivo = window.prompt('Motivo del salto', 'Corrección administrativa') ?? '';
    setBusy(true);
    setLocalErr(null);
    try {
      await manualStageSkipTo(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        dest: skipPick,
        motivo: motivo.trim() || 'Corrección administrativa',
      });
      setSkipPick('');
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo saltar de etapa.');
    } finally {
      setBusy(false);
    }
  }, [skipPick, openRow, caseId, courtId, radicado, caseType, assignedTo, stages.refetch, refetch]);

  const skipOptions = useMemo(() => {
    if (!openRow) return [];
    const i0 = pipeline.indexOf(openRow.stageCode);
    return pipeline.filter((_, i) => i > i0);
  }, [pipeline, openRow]);

  /** Ramas del grafo BD (`process_stage_transitions`) para la etapa abierta. */
  const branchTransitions = useMemo(() => {
    if (!openRow || !caseType) return [];
    return getBranchTransitionsFromStage(caseType, openRow.stageCode);
  }, [openRow, caseType]);

  const editEnteredAt = useCallback(
    async (rowId: string, currentIso: string) => {
      const raw = window.prompt(
        'Nueva fecha y hora de entrada (AAAA-MM-DDTHH:mm)',
        currentIso.slice(0, 16),
      );
      if (raw == null) return;
      const motivo = window.prompt('Motivo del ajuste', 'Rectificación de fecha') ?? '';
      const d = parseISO(raw);
      if (Number.isNaN(d.getTime())) {
        setLocalErr('Fecha inválida.');
        return;
      }
      setBusy(true);
      setLocalErr(null);
      try {
        await manualStageEditEnteredAt(supabase, {
          caseId,
          stageRowId: rowId,
          newEnteredAtIso: d.toISOString(),
          motivo: motivo.trim() || 'Rectificación de fecha',
        });
        await stages.refetch();
        await refetch.refetchActions();
      } catch (e) {
        setLocalErr(e instanceof Error ? e.message : 'No se pudo actualizar la fecha.');
      } finally {
        setBusy(false);
      }
    },
    [caseId, stages.refetch, refetch],
  );

  const registrarNotifAuto = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionNotificacionAutoEnviada(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
        notifiedAt: fechaNotifAuto,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, fechaNotifAuto, stages.refetch, refetch]);

  const registrarNotifFallo = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionNotificacionFalloEnviada(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
        notifiedAt: fechaNotifFallo,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, fechaNotifFallo, stages.refetch, refetch]);

  const registrarExpedienteRecibido = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionExpedienteRecibidoAlDespacho(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_segunda',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, stages.refetch, refetch]);

  const registrarRemisionCorte = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionRemisionCorteRegistrada(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_segunda',
        caseAssignedTo: assignedTo,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, stages.refetch, refetch]);

  const registrarImpugnacion = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionImpugnacionRecibida(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, stages.refetch, refetch]);

  const registrarRemisionSuperior = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionRemisionSuperiorRegistrada(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, stages.refetch, refetch]);

  const registrarInadmision = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionInadmisionRegistrada(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, stages.refetch, refetch]);

  const registrarRechazo = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionRechazoRegistrado(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'tutela_primera',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, stages.refetch, refetch]);

  const registrarApelacion = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionApelacionRecibida(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'civil_ordinario',
        caseAssignedTo: assignedTo,
        expedienteDocs: docs,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, docs, stages.refetch, refetch]);

  const registrarContestacionCerrada = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionContestacionCerrada(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'civil_ordinario',
        caseAssignedTo: assignedTo,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, stages.refetch, refetch]);

  const registrarIngresoSentencia = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyStageTransitionIngresoDespachoParaSentencia(supabase, {
        caseId,
        courtId,
        radicado,
        caseType: caseType ?? 'civil_ordinario',
        caseAssignedTo: assignedTo,
      });
      await stages.refetch();
      await refetch.refetchCase();
      await refetch.refetchActions();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      setBusy(false);
    }
  }, [caseId, courtId, radicado, caseType, assignedTo, stages.refetch, refetch]);

  const hist = useMemo(() => [...stages.rows].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt)), [stages.rows]);

  const stripLabel = openRow ? stageLabel(openRow.stageCode) : 'Sin etapa';

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="group flex w-full max-w-xl items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-accent/40 hover:bg-slate-50/80"
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Etapas</span>
            {openRow ? (
              <span
                className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                  badgeSecret ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
                }`}
              >
                {badgeSecret ? 'Secretaría' : 'Despacho'}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-1.5 flex-1 min-w-[72px] overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all ${badgeSecret ? 'bg-blue-500' : 'bg-emerald-500'}`}
                style={{ width: openRow ? '100%' : '28%' }}
              />
            </div>
            <span className="truncate text-xs font-bold text-slate-800">{stripLabel}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-accent" aria-hidden />
          </div>
        </div>
        <PanelRightOpen className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>

      {drawerOpen ? (
        <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Etapas del trámite">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Cerrar"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Etapas del trámite</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar panel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {(stages.error || localErr) && (
                <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{localErr || stages.error}</span>
                </div>
              )}

              {stages.loading || stages.bootstrapping ? (
                <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  Cargando…
                </div>
              ) : (
                <>
                  {(caseType === 'tutela_primera' || caseType === 'tutela_segunda') && (plazoFallar || plazoEtapa) ? (
                    <section className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-3 text-xs text-amber-950">
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                        Plazos
                      </p>
                      {plazoFallar ? (
                        <p className="mt-2">
                          <span className="font-bold">
                            Fallar la tutela ({plazoFallar.termDays} días háb. desde {plazoFallar.anchorLabel}):{' '}
                          </span>
                          {plazoFallar.pendingAnchor ? (
                            <span className="text-amber-900">
                              pendiente de registrar recepción del expediente en despacho
                            </span>
                          ) : plazoFallar.remaining > 0 ? (
                            <>
                              quedan <strong>{plazoFallar.remaining}</strong> día(s) hábil(es)
                              {plazoFallar.end ? (
                                <> — vence {format(plazoFallar.end, "d MMM yyyy", { locale: es })}</>
                              ) : null}
                            </>
                          ) : (
                            <strong className="text-red-800">término vencido o en el último día hábil</strong>
                          )}
                        </p>
                      ) : null}
                      {plazoEtapa ? (
                        <p className={plazoFallar ? 'mt-2 border-t border-amber-200/80 pt-2' : 'mt-2'}>
                          <span className="font-bold">{plazoEtapa.label}: </span>
                          {plazoEtapa.remaining > 0 ? (
                            <>
                              quedan <strong>{plazoEtapa.remaining}</strong> día(s) hábil(es) — vence{' '}
                              {format(plazoEtapa.end, "d MMM yyyy", { locale: es })}
                            </>
                          ) : (
                            <strong className="text-red-800">vencido</strong>
                          )}
                        </p>
                      ) : null}
                    </section>
                  ) : null}

                  {supportsContestacionWorkflow(caseType ?? 'tutela_primera') &&
                  openRow &&
                  (openRow.stageCode === 'TERMINO_RESPUESTA' ||
                    openRow.stageCode === 'TERMINO_EXCEPCIONES' ||
                    openRow.stageCode === 'INGRESO_DESPACHO_FALLO') ? (
                    <CaseContestacionChecklistPanel
                      caseItem={caseItem}
                      docs={docs}
                      openStageCode={openRow.stageCode}
                      plazoVencido={plazoEtapa != null && plazoEtapa.remaining <= 0}
                      compact
                    />
                  ) : null}

                  {canRegistrarHitosSecretaria(role) &&
                  (supportsContestacionWorkflow(caseType ?? 'tutela_primera') ||
                    caseType === 'tutela_segunda' ||
                    caseType === 'consulta_desacato') ? (
                    <section className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-3 text-xs">
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">
                        Registrar hitos (secretaría)
                      </p>
                      <div className="mt-2 flex flex-col gap-2">
                        {(caseType === 'tutela_primera' || supportsContestacionWorkflow(caseType ?? 'tutela_primera')) &&
                        openRow?.stageCode === 'ADMISION' ? (
                          <>
                            <label className="block text-[11px] font-semibold text-indigo-950">
                              Fecha de notificación
                              <input
                                type="date"
                                value={fechaNotifAuto}
                                onChange={(e) => setFechaNotifAuto(e.target.value)}
                                className="input-modern mt-1 w-full text-sm"
                                disabled={busy}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={busy || !gateNotifAuto.ok}
                              onClick={() => void registrarNotifAuto()}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              {isCivil ? 'Notificación del auto admisorio enviada' : 'Notificación enviada (auto admisorio)'}
                            </button>
                            {stageActGateMessage(gateNotifAuto) ? (
                              <p className="text-[11px] leading-snug text-indigo-950/90">
                                {stageActGateMessage(gateNotifAuto)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {openRow?.stageCode === 'FALLO' ? (
                          <>
                            <label className="block text-[11px] font-semibold text-indigo-950">
                              Fecha de notificación
                              <input
                                type="date"
                                value={fechaNotifFallo}
                                onChange={(e) => setFechaNotifFallo(e.target.value)}
                                className="input-modern mt-1 w-full text-sm"
                                disabled={busy}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={busy || !gateNotifFallo.ok}
                              onClick={() => void registrarNotifFallo()}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              {isCivil ? 'Notificación de la sentencia enviada' : 'Notificación del fallo enviada'}
                            </button>
                            {stageActGateMessage(gateNotifFallo) ? (
                              <p className="text-[11px] leading-snug text-indigo-950/90">
                                {stageActGateMessage(gateNotifFallo)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {caseType === 'tutela_primera' && openRow?.stageCode === 'TERMINO_IMPUGNACION' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy || !gateImpugnacion.ok}
                              onClick={() => void registrarImpugnacion()}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              Impugnación recibida
                            </button>
                            {stageActGateMessage(gateImpugnacion) ? (
                              <p className="text-[11px] leading-snug text-indigo-950/90">
                                {stageActGateMessage(gateImpugnacion)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {caseType === 'tutela_primera' && openRow?.stageCode === 'REMISION_SUPERIOR' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy || !gateRemisionSuperior.ok}
                              onClick={() => void registrarRemisionSuperior()}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              Remisión al superior registrada
                            </button>
                            {stageActGateMessage(gateRemisionSuperior) ? (
                              <p className="text-[11px] leading-snug text-indigo-950/90">
                                {stageActGateMessage(gateRemisionSuperior)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {(caseType === 'tutela_segunda' || caseType === 'consulta_desacato') &&
                        openRow?.stageCode === 'RADICACION' &&
                        caseItem.informeIngresoRegistradoAt ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void registrarExpedienteRecibido()}
                            className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-emerald-800 disabled:opacity-40"
                          >
                            Expediente recibido → ingreso al despacho
                          </button>
                        ) : null}
                        {caseType === 'tutela_segunda' && openRow?.stageCode === 'EJECUTORIA' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy || !gateRemisionCorte.ok}
                              onClick={() => void registrarRemisionCorte()}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              Envío a la Corte registrado
                            </button>
                            {stageActGateMessage(gateRemisionCorte) ? (
                              <p className="text-[11px] leading-snug text-indigo-950/90">
                                {stageActGateMessage(gateRemisionCorte)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {(isCivil && (openRow?.stageCode === 'TERMINO_RESPUESTA' || openRow?.stageCode === 'TERMINO_EXCEPCIONES')) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void registrarContestacionCerrada()}
                            className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            {isEjecutivo
                              ? 'Excepciones cerradas → trámite (CGP art. 443)'
                              : 'Contestación cerrada → trámite (CGP art. 76)'}
                          </button>
                        ) : null}
                        {isCivil && openRow?.stageCode === 'TRAMITE' && canRegistrarRamaAdmision(role) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void registrarIngresoSentencia()}
                            className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-emerald-800 disabled:opacity-40"
                          >
                            Ingreso al despacho para sentencia
                          </button>
                        ) : null}
                        {isCivil && openRow?.stageCode === 'TERMINO_APELACION' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy || !gateApelacion.ok}
                              onClick={() => void registrarApelacion()}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                            >
                              Apelación recibida (remisión superior)
                            </button>
                            {stageActGateMessage(gateApelacion) ? (
                              <p className="text-[11px] leading-snug text-indigo-950/90">
                                {stageActGateMessage(gateApelacion)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {openRow &&
                        ![
                          'ADMISION',
                          'FALLO',
                          'TERMINO_IMPUGNACION',
                          'TERMINO_APELACION',
                          'REMISION_SUPERIOR',
                          'EJECUTORIA',
                          'TERMINO_RESPUESTA',
                          'TERMINO_EXCEPCIONES',
                          'TRAMITE',
                        ].includes(openRow.stageCode) ? (
                          <p className="text-[11px] text-indigo-900/80">
                            No hay registro rápido para la etapa actual. Use el historial o el flujo automático.
                          </p>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {canRegistrarRamaAdmision(role) && !isCivil ? (
                    <section className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-3 text-xs">
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">
                        Ramas de admisión (despacho)
                      </p>
                      {branchTransitions.length > 0 ? (
                        <ul className="mt-1 list-inside list-disc text-[10px] text-amber-900/80">
                          {branchTransitions.map((t) => (
                            <li key={`${t.from_stage_code}-${t.to_stage_code}`}>
                              {t.label ?? `${t.from_stage_code} → ${t.to_stage_code}`}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2 flex flex-col gap-2">
                        {openRow?.stageCode === 'ADMISION' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy || !gateInadmision.ok}
                              onClick={() => void registrarInadmision()}
                              className="rounded-lg bg-amber-700 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-amber-800 disabled:opacity-40"
                            >
                              Inadmisión registrada (archivo)
                            </button>
                            {stageActGateMessage(gateInadmision) ? (
                              <p className="text-[11px] leading-snug text-amber-950/90">
                                {stageActGateMessage(gateInadmision)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {openRow?.stageCode === 'RADICACION' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy || !gateRechazo.ok}
                              onClick={() => void registrarRechazo()}
                              className="rounded-lg bg-amber-700 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-amber-800 disabled:opacity-40"
                            >
                              Rechazo de demanda registrado (archivo)
                            </button>
                            {stageActGateMessage(gateRechazo) ? (
                              <p className="text-[11px] leading-snug text-amber-950/90">
                                {stageActGateMessage(gateRechazo)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {openRow?.stageCode === 'INADMISION' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy || !gateInadmision.ok}
                              onClick={() => void registrarInadmision()}
                              className="rounded-lg bg-amber-700 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-amber-800 disabled:opacity-40"
                            >
                              Cerrar inadmisión (archivo)
                            </button>
                            {stageActGateMessage(gateInadmision) ? (
                              <p className="text-[11px] leading-snug text-amber-950/90">
                                {stageActGateMessage(gateInadmision)}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                        {openRow &&
                        !['ADMISION', 'RADICACION', 'INADMISION'].includes(openRow.stageCode) ? (
                          <p className="text-[11px] text-amber-900/80">
                            No hay registro de rama para la etapa actual.
                          </p>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {canRegistrarRamaAdmision(role) && isCivil ? (
                    <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
                      <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Ramas excepcionales (inadmisión / rechazo)
                      </summary>
                      <p className="mt-2 text-[11px] leading-snug text-slate-600">
                        En procesos civiles el carril ordinario es admisión → traslado → contestación → trámite →
                        sentencia. Use estas ramas solo cuando corresponda un auto inadmisorio o de rechazo.
                      </p>
                      {branchTransitions.length > 0 ? (
                        <ul className="mt-2 list-inside list-disc text-[10px] text-slate-600">
                          {branchTransitions.map((t) => (
                            <li key={`${t.from_stage_code}-${t.to_stage_code}`}>
                              {t.label ?? `${t.from_stage_code} → ${t.to_stage_code}`}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2 flex flex-col gap-2">
                        {openRow?.stageCode === 'ADMISION' || openRow?.stageCode === 'INADMISION' ? (
                          <button
                            type="button"
                            disabled={busy || !gateInadmision.ok}
                            onClick={() => void registrarInadmision()}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-900 hover:bg-amber-50 disabled:opacity-40"
                          >
                            Cerrar por inadmisión (archivo)
                          </button>
                        ) : null}
                        {openRow?.stageCode === 'RADICACION' ? (
                          <button
                            type="button"
                            disabled={busy || !gateRechazo.ok}
                            onClick={() => void registrarRechazo()}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-900 hover:bg-amber-50 disabled:opacity-40"
                          >
                            Rechazo de demanda (archivo)
                          </button>
                        ) : null}
                      </div>
                    </details>
                  ) : null}

                  {canManualManageCaseStages(role) ? (
                    <section className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Modificación manual
                      </p>
                      {openRow && pipeline.indexOf(openRow.stageCode) > 0 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRetroceder()}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                        >
                          Retroceder etapa
                        </button>
                      ) : null}
                      {skipOptions.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <label className="text-[11px] font-semibold text-slate-600">
                            Saltar a
                            <select
                              className="input-modern mt-1 w-full text-xs"
                              value={skipPick}
                              onChange={(e) => setSkipPick((e.target.value || '') as CaseStageCode | '')}
                            >
                              <option value="">— Elija etapa —</option>
                              {skipOptions.map((c) => (
                                <option key={c} value={c}>
                                  {stageLabel(c)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={busy || !skipPick}
                            onClick={() => void handleSaltar()}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-40"
                          >
                            Saltar a esta etapa
                          </button>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                      Historial
                    </p>
                    <ol className="space-y-2">
                      {hist.map((r) => {
                        const isOpen = !r.exitedAt;
                        const omitida = Boolean(r.metadata?.omitida);
                        return (
                          <li
                            key={r.id}
                            className={`rounded-lg border px-3 py-2 text-xs ${
                              isOpen
                                ? 'border-accent/50 bg-blue-50/60'
                                : omitida
                                  ? 'border-amber-100 bg-amber-50/40'
                                  : 'border-slate-100 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-[10px] text-slate-400">{r.stageCode}</span>
                                  {omitida ? (
                                    <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-950">
                                      Omitida
                                    </span>
                                  ) : null}
                                  {isOpen ? (
                                    <span className="text-[9px] font-black uppercase text-accent">En curso</span>
                                  ) : null}
                                </div>
                                <p className="font-semibold text-slate-800">{stageLabel(r.stageCode)}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                  Entrada: {formatStageDate(r.enteredAt)}
                                  {r.exitedAt ? ` · Salida: ${formatStageDate(r.exitedAt)}` : ''}
                                </p>
                              </div>
                              {canEditStageEnteredAt(role) ? (
                                <button
                                  type="button"
                                  title="Editar fecha de entrada"
                                  disabled={busy}
                                  onClick={() => void editEnteredAt(r.id, r.enteredAt)}
                                  className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                                >
                                  <Calendar className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
