import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaseType, Document } from '../types';
import { startOfLocalDay, businessDayTermEndAfterEvent } from './business-days';
import {
  canRegistrarImpugnacionRecibida,
  canRegistrarNotificacionAutoEnviada,
  canRegistrarNotificacionFalloEnviada,
  canRegistrarRemisionCorte,
  canRegistrarRemisionSuperior,
  canRegistrarInadmision,
  canRegistrarRechazoDemanda,
  canRegistrarApelacionRecibida,
} from './case-stage-act-gates';
import { businessDayTermEnd } from './business-days';
import { PLAZO_REMISION_EXPEDIENTE_IMPUGNACION_DIAS } from './decreto-2591-plazos';
import {
  metadataForContestacionDeadline,
  metadataForExcepcionesDeadline,
  metadataForApelacionDeadline,
  metadataForImpugnacionDeadline,
  resolveSubStageDeadline,
} from './case-stage-deadlines';
import {
  pipelineForCaseType,
  responsibleRoleForStage,
  resolveWorkflowAssigneeId,
  STAGE_LABEL_ES,
  stageLabelForCaseType,
  workflowTaskPayloadForStage,
  type CaseStageCode,
} from './case-workflow-stages';
import { insertWorkflowStageEntryNotifications } from './workflow-stage-notifications';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';
import { getCachedStageDefinitionId } from './process-definitions-service';
import { getLinearNextStage, resolveTerminoRespuestaVencidoNext } from './process-stage-transitions';
import { rowToCaseDoc } from './supabase-mappers';
import { caseHasAnyAct } from './case-act-types';
import {
  supportsContestacionWorkflow,
  supportsNotificacionFalloWorkflow,
  initialResponseTermStageForCaseType,
  supportsApelacionWorkflow,
} from './sgde-case-scope';
import { isCivilCaseType } from './process-product-scope';
import { computePlazoFallarDeadlineAt } from './plazo-fallar-tutela';
import {
  parseCatalogMetadata,
  patchCivilCatalogMetadataForStage,
} from './case-catalog-metadata';

export {
  canManualManageCaseStages,
  canEditStageEnteredAt,
} from './role-capabilities';

async function resolveExpedienteDocsForGate(
  supabase: SupabaseClient,
  caseId: string,
  provided?: Document[],
): Promise<Document[]> {
  if (provided) return provided;
  const { data, error } = await supabase.from('case_documents').select('*').eq('case_id', caseId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToCaseDoc(r as Record<string, unknown>, caseId));
}

export type CaseStageRowDb = {
  id: string;
  stage_code: string;
  responsible_role: string | null;
  entered_at: string;
  exited_at: string | null;
  metadata?: Record<string, unknown> | null;
};

async function authActor(supabase: SupabaseClient): Promise<{ userId: string | null; userName: string }> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id ?? null;
  const userName =
    (u.user?.user_metadata?.full_name as string | undefined)?.trim() ||
    u.user?.email?.trim() ||
    'Sistema';
  return { userId, userName: String(userName) };
}

async function insertCaseAction(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    type: string;
    description: string;
    userId: string | null;
    userName: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from('case_actions').insert({
    case_id: opts.caseId,
    type: opts.type,
    description: opts.description,
    user_id: opts.userId,
    user_name: opts.userName,
    metadata: opts.metadata ?? {},
  });
  if (error) console.error('case_actions insert:', error);
}

async function fetchOpenStageRow(
  supabase: SupabaseClient,
  caseId: string,
): Promise<CaseStageRowDb | null> {
  const { data, error } = await supabase
    .from('case_stages')
    .select('id, stage_code, responsible_role, entered_at, exited_at, metadata')
    .eq('case_id', caseId)
    .is('exited_at', null)
    .maybeSingle();
  if (error) {
    console.error('fetchOpenStageRow:', error);
    return null;
  }
  if (!data) return null;
  return data as CaseStageRowDb;
}

function requireOpenStageAt(
  open: CaseStageRowDb | null,
  expected: CaseStageCode | CaseStageCode[],
  actionLabel: string,
): CaseStageRowDb {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (!open?.stage_code) {
    throw new Error(
      `No hay etapa abierta. Para ${actionLabel} el expediente debe estar en ${expectedList.map((s) => STAGE_LABEL_ES[s]).join(' o ')}.`,
    );
  }
  const current = open.stage_code as CaseStageCode;
  if (!expectedList.includes(current)) {
    throw new Error(
      `Para ${actionLabel} la etapa debe ser ${expectedList.map((s) => STAGE_LABEL_ES[s]).join(' o ')}, pero está en ${STAGE_LABEL_ES[current] ?? current}.`,
    );
  }
  return open;
}

async function enqueueWorkflowTaskForStage(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    stage: CaseStageCode;
    creatorId: string | null;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  const rr = responsibleRoleForStage(opts.stage);
  const assigneeId = await resolveWorkflowAssigneeId(supabase, {
    courtId: opts.courtId,
    role: rr,
    caseAssignedTo: opts.caseAssignedTo,
  });
  if (!assigneeId) return;
  const payload = workflowTaskPayloadForStage(opts.stage, opts.radicado);
  const { error: tErr } = await supabase.from('workflow_tasks').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    radicado: opts.radicado,
    title: payload.title,
    description: payload.description,
    assignee_id: assigneeId,
    creator_id: opts.creatorId,
    status: 'pending',
    priority: 'medium',
    task_type: payload.task_type,
    metadata: { case_stage_code: opts.stage, responsible_role: rr },
  });
  if (tErr) console.error('workflow_tasks:', tErr);
}

async function closeStageById(supabase: SupabaseClient, stageId: string, exitedAt: string): Promise<void> {
  const { error } = await supabase.from('case_stages').update({ exited_at: exitedAt }).eq('id', stageId).is('exited_at', null);
  if (error) throw error;
}

async function insertCaseStage(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    stage: CaseStageCode;
    enteredAt: string;
    previousStageCode?: CaseStageCode | null;
    createdBy: string | null;
    metadata?: Record<string, unknown>;
    caseType?: CaseType;
    exitedAt?: string | null;
  },
): Promise<void> {
  const rr = responsibleRoleForStage(opts.stage);
  const stageDefinitionId = getCachedStageDefinitionId(opts.caseType, opts.stage);
  const row: Record<string, unknown> = {
    court_id: opts.courtId,
    case_id: opts.caseId,
    stage_code: opts.stage,
    responsible_role: rr,
    entered_at: opts.enteredAt,
    previous_stage_code: opts.previousStageCode ?? null,
    created_by: opts.createdBy,
    metadata: opts.metadata ?? {},
  };
  if (stageDefinitionId) row.stage_definition_id = stageDefinitionId;
  if (opts.exitedAt) row.exited_at = opts.exitedAt;
  const { error } = await supabase.from('case_stages').insert(row);
  if (error) throw error;
}

async function insertOpenStage(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    stage: CaseStageCode;
    enteredAt: string;
    previousStageCode?: CaseStageCode | null;
    createdBy: string | null;
    metadata?: Record<string, unknown>;
    caseType?: CaseType;
  },
): Promise<void> {
  await insertCaseStage(supabase, opts);
}

/** Expediente recién radicado: primera etapa abierta. */
export async function openRadicacionStageAfterRadicate(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const { count, error: cErr } = await supabase
    .from('case_stages')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', opts.caseId);
  if (cErr) {
    console.error('case_stages count:', cErr);
    return;
  }
  if ((count ?? 0) > 0) return;

  const { userId, userName } = await authActor(supabase);
  const pipeline = pipelineForCaseType(opts.caseType);
  const first = pipeline[0] ?? 'RADICACION';
  const now = new Date().toISOString();
  try {
    await insertCaseStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      stage: first,
      enteredAt: now,
      createdBy: userId,
      caseType: opts.caseType,
      metadata: { source: 'radicacion' },
    });
  } catch (insErr) {
    console.error('openRadicacionStageAfterRadicate:', insErr);
    return;
  }
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `Etapa abierta: ${STAGE_LABEL_ES[first]} (${first})`,
    userId,
    userName,
    metadata: { etapa_anterior: null, etapa_nueva: first, trigger: 'RADICACION_COMPLETADA' },
  });
  if (isCivilCaseType(opts.caseType)) {
    try {
      const { data: caseRow } = await supabase
        .from('cases')
        .select('catalog_metadata, operational_status, assigned_to')
        .eq('id', opts.caseId)
        .maybeSingle();
      const prev = parseCatalogMetadata(caseRow?.catalog_metadata);
      const nextMeta = patchCivilCatalogMetadataForStage(prev, {
        caseType: opts.caseType,
        stageCode: first,
        ubicacionInterna: prev?.ubicacion_interna || 'Para ingresar al despacho',
      });
      if (nextMeta) {
        if (!nextMeta.encargado_nombre?.trim() && (opts.caseAssignedTo || caseRow?.assigned_to)) {
          nextMeta.encargado_nombre = String(opts.caseAssignedTo || caseRow?.assigned_to || '').trim();
        }
        const patch: Record<string, unknown> = { catalog_metadata: nextMeta };
        if (!String(caseRow?.operational_status || '').trim()) {
          patch.operational_status = nextMeta.ubicacion_interna || 'Para ingresar al despacho';
        }
        await supabase.from('cases').update(patch).eq('id', opts.caseId);
      }
    } catch (e) {
      console.error('catalog_metadata civil tras radicación:', e);
    }
  }
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: first,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Sustanciador envía auto a revisión: solo traza (no cambia etapa). */
export async function recordBorradorAutoEnviadoRevision(
  supabase: SupabaseClient,
  opts: { caseId: string; documentLabel?: string },
): Promise<void> {
  await recordBorradorProvidenciaEnviadoRevision(supabase, { ...opts, kind: 'auto_admisorio' });
}

/** Trazabilidad al enviar borrador de auto de trámite o sentencia a revisión. */
export async function recordBorradorProvidenciaEnviadoRevision(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    documentLabel?: string;
    kind: 'auto_admisorio' | 'auto_tramite' | 'sentencia' | 'fallo';
  },
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const labels: Record<typeof opts.kind, string> = {
    auto_admisorio: 'Borrador del auto admisorio enviado a revisión',
    auto_tramite: 'Borrador de auto de trámite enviado a revisión',
    sentencia: 'Borrador de sentencia enviado a revisión',
    fallo: 'Borrador de fallo de tutela enviado a revisión',
  };
  const { userId, userName } = await authActor(supabase);
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'REGISTRO_INTERNO_REVISION',
    description: `${labels[opts.kind]}${opts.documentLabel ? `: ${opts.documentLabel}` : ''}`,
    userId,
    userName,
    metadata: { trigger: 'BORRADOR_PROVIDENCIA_ENVIADO_REVISION', kind: opts.kind },
  });
}

function isBorradorAutoAdmisorioDocType(t: string | undefined): boolean {
  return t === 'borrador_auto_admisorio_revision';
}

function isBorradorAutoTramiteDocType(t: string | undefined): boolean {
  return t === 'borrador_auto_tramite_revision';
}

function isBorradorSentenciaDocType(t: string | undefined): boolean {
  return t === 'borrador_sentencia_revision';
}

function isBorradorAutoInadmisorioDocType(t: string | undefined): boolean {
  return t === 'borrador_auto_inadmisorio_revision';
}

function isBorradorFalloDocType(t: string | undefined): boolean {
  if (!t) return false;
  if (isBorradorSentenciaDocType(t)) return true;
  return t.includes('fallo') && t.includes('revision');
}

/** Juez aprueba borrador en Tutelia (estado aprobado_firma_pendiente). */
export async function applyStageTransitionJudgeApprovedBorrador(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    wordDocumentType: string | undefined;
  },
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open?.stage_code) return;
  const current = open.stage_code as CaseStageCode;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();

  if (supportsContestacionWorkflow(opts.caseType) && isBorradorAutoAdmisorioDocType(opts.wordDocumentType)) {
    if (current !== 'RADICACION') return;
    const next: CaseStageCode = getLinearNextStage(opts.caseType, 'RADICACION') ?? 'ADMISION';
    await closeStageById(supabase, open.id, now);
    await insertOpenStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      stage: next,
      enteredAt: now,
      previousStageCode: current,
      createdBy: userId,
      caseType: opts.caseType,
      metadata: { source: 'juez_aprueba_auto_admisorio' },
    });
    await insertCaseAction(supabase, {
      caseId: opts.caseId,
      type: 'CAMBIO_ETAPA_AUTOMATICO',
      description: `${STAGE_LABEL_ES[current]} → ${STAGE_LABEL_ES[next]}`,
      userId,
      userName,
      metadata: {
        etapa_anterior: current,
        etapa_nueva: next,
        trigger: 'JUEZ_APROBO_BORRADOR_AUTO_ADMISORIO',
        usuario: userName,
      },
    });
    await insertWorkflowStageEntryNotifications(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      radicado: opts.radicado,
      enteredStage: next,
    });
    await enqueueWorkflowTaskForStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      radicado: opts.radicado,
      stage: next,
      creatorId: userId,
      caseAssignedTo: opts.caseAssignedTo,
    });
    return;
  }

  if (isBorradorAutoInadmisorioDocType(opts.wordDocumentType)) {
    if (current !== 'RADICACION' && current !== 'ADMISION') return;
    const next: CaseStageCode = 'INADMISION';
    await closeStageById(supabase, open.id, now);
    await insertOpenStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      stage: next,
      enteredAt: now,
      previousStageCode: current,
      createdBy: userId,
      caseType: opts.caseType,
      metadata: { source: 'juez_aprueba_auto_inadmisorio' },
    });
    await insertCaseAction(supabase, {
      caseId: opts.caseId,
      type: 'CAMBIO_ETAPA_AUTOMATICO',
      description: `${STAGE_LABEL_ES[current]} → ${STAGE_LABEL_ES[next]}`,
      userId,
      userName,
      metadata: {
        etapa_anterior: current,
        etapa_nueva: next,
        trigger: 'JUEZ_APROBO_BORRADOR_AUTO_INADMISORIO',
        usuario: userName,
      },
    });
    await insertWorkflowStageEntryNotifications(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      radicado: opts.radicado,
      enteredStage: next,
    });
    return;
  }

  if (isBorradorFalloDocType(opts.wordDocumentType)) {
    if (current !== 'INGRESO_DESPACHO_FALLO') return;
    await insertCaseAction(supabase, {
      caseId: opts.caseId,
      type: 'CAMBIO_ETAPA_AUTOMATICO',
      description: `Borrador de ${isBorradorSentenciaDocType(opts.wordDocumentType) ? 'sentencia' : 'fallo'} aprobado — pendiente PDF firmado en expediente`,
      userId,
      userName,
      metadata: {
        etapa_anterior: current,
        etapa_nueva: current,
        trigger: isBorradorSentenciaDocType(opts.wordDocumentType)
          ? 'JUEZ_APROBO_BORRADOR_SENTENCIA_PENDIENTE_FIRMA'
          : 'JUEZ_APROBO_BORRADOR_FALLO_PENDIENTE_FIRMA',
        usuario: userName,
      },
    });
    return;
  }

  if (isBorradorAutoTramiteDocType(opts.wordDocumentType)) {
    await insertCaseAction(supabase, {
      caseId: opts.caseId,
      type: 'CAMBIO_ETAPA_AUTOMATICO',
      description: 'Borrador de auto de trámite aprobado — pendiente PDF firmado en expediente',
      userId,
      userName,
      metadata: {
        etapa_anterior: current,
        etapa_nueva: current,
        trigger: 'JUEZ_APROBO_BORRADOR_AUTO_TRAMITE_PENDIENTE_FIRMA',
        usuario: userName,
      },
    });
    return;
  }
}

/** Fallo: PDF firmado vinculado en expediente → etapa FALLO. */
export async function applyStageTransitionFalloPdfFirmado(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open?.stage_code) return;
  const current = open.stage_code as CaseStageCode;
  if (current !== 'INGRESO_DESPACHO_FALLO') return;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'FALLO';
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: current,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'fallo_pdf_firmado_expediente' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[current]} → ${STAGE_LABEL_ES[next]} (PDF firmado)`,
    userId,
    userName,
    metadata: {
      etapa_anterior: current,
      etapa_nueva: next,
      trigger: 'FALLO_PDF_FIRMADO',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Etapa posterior a notificación del fallo/sentencia según tipo de proceso. */
function nextStageAfterNotificacionFallo(caseType: CaseType): CaseStageCode {
  if (caseType === 'tutela_primera') return 'TERMINO_IMPUGNACION';
  if (isCivilCaseType(caseType)) return 'TERMINO_APELACION';
  return 'EJECUTORIA';
}

function metadataForResponseTermDeadline(notifiedOn: Date, caseType: CaseType): Record<string, unknown> {
  if (caseType === 'civil_ejecutivo') return metadataForExcepcionesDeadline(notifiedOn, caseType);
  return metadataForContestacionDeadline(notifiedOn, caseType);
}

/** Secretaría: notificación del auto admisorio enviada (tutela 1ª y civiles). */
export async function applyStageTransitionNotificacionAutoEnviada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    /** Si se omite, se consulta `case_documents` antes de avanzar etapa. */
    expedienteDocs?: Document[];
    /** Fecha real de notificación (día civil); por defecto hoy. */
    notifiedAt?: string | Date;
  },
): Promise<void> {
  if (!supportsContestacionWorkflow(opts.caseType)) return;
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  const gate = canRegistrarNotificacionAutoEnviada(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = requireOpenStageAt(
    await fetchOpenStageRow(supabase, opts.caseId),
    'ADMISION',
    'registrar notificación del auto admisorio',
  );
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const t0 = now;
  const notif: CaseStageCode = 'NOTIFICACION_AUTO_ADMISORIO';
  const termino: CaseStageCode = initialResponseTermStageForCaseType(opts.caseType);

  await closeStageById(supabase, open.id, now);
  await insertCaseStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: notif,
    enteredAt: t0,
    exitedAt: t0,
    previousStageCode: 'ADMISION',
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'notificacion_auto_instantanea' },
  });
  const notifiedDay = startOfLocalDay(
    opts.notifiedAt != null ? new Date(opts.notifiedAt) : new Date(),
  );
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: termino,
    enteredAt: t0,
    previousStageCode: notif,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: {
      source: 'notificacion_auto_enviada',
      notified_at: notifiedDay.toISOString(),
      ...metadataForResponseTermDeadline(notifiedDay, opts.caseType),
    },
  });
  await supabase.from('cases').update({ updated_at: now }).eq('id', opts.caseId);

  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `Admisión → Notificación auto admisorio → ${STAGE_LABEL_ES[termino]}`,
    userId,
    userName,
    metadata: {
      etapa_anterior: 'ADMISION',
      etapa_nueva: termino,
      trigger: 'SECRETARIA_NOTIFICACION_AUTO_ENVIADA',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: termino,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: termino,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

async function advanceBranchToEjecutoriaArchivado(
  supabase: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    openStageId: string;
    previousStage: CaseStageCode;
    branchStage: CaseStageCode;
    trigger: string;
    source: string;
    userId: string | null;
    userName: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const t0 = now;
  await closeStageById(supabase, opts.openStageId, now);
  await insertCaseStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: opts.branchStage,
    enteredAt: t0,
    exitedAt: t0,
    previousStageCode: opts.previousStage,
    createdBy: opts.userId,
    caseType: opts.caseType,
    metadata: { source: opts.source },
  });
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'EJECUTORIA',
    enteredAt: t0,
    previousStageCode: opts.branchStage,
    createdBy: opts.userId,
    caseType: opts.caseType,
    metadata: { source: opts.source, archivo: true },
  });
  await supabase
    .from('cases')
    .update({ status: 'archived', updated_at: now })
    .eq('id', opts.caseId);

  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[opts.previousStage]} → ${STAGE_LABEL_ES[opts.branchStage]} → ${STAGE_LABEL_ES.EJECUTORIA} (archivo)`,
    userId: opts.userId,
    userName: opts.userName,
    metadata: {
      etapa_anterior: opts.previousStage,
      etapa_nueva: 'EJECUTORIA',
      trigger: opts.trigger,
      usuario: opts.userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: 'EJECUTORIA',
  });
}

/** Despacho/secretaría: inadmisión con auto inadmisorio en expediente → ejecutoria/archivo. */
export async function applyStageTransitionInadmisionRegistrada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    expedienteDocs?: Document[];
  },
): Promise<void> {
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  const gate = canRegistrarInadmision(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || (open.stage_code !== 'ADMISION' && open.stage_code !== 'INADMISION')) return;
  const { userId, userName } = await authActor(supabase);
  await advanceBranchToEjecutoriaArchivado(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    caseType: opts.caseType,
    caseAssignedTo: opts.caseAssignedTo,
    openStageId: open.id,
    previousStage: open.stage_code as CaseStageCode,
    branchStage: 'INADMISION',
    trigger: 'DESPACHO_INADMISION_REGISTRADA',
    source: 'inadmision_registrada',
    userId,
    userName,
  });
}

/** Despacho/secretaría: rechazo de demanda con auto en expediente → ejecutoria/archivo. */
export async function applyStageTransitionRechazoRegistrado(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    expedienteDocs?: Document[];
  },
): Promise<void> {
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  const gate = canRegistrarRechazoDemanda(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'RADICACION') return;
  const { userId, userName } = await authActor(supabase);
  await advanceBranchToEjecutoriaArchivado(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    caseType: opts.caseType,
    caseAssignedTo: opts.caseAssignedTo,
    openStageId: open.id,
    previousStage: 'RADICACION',
    branchStage: 'RECHAZO',
    trigger: 'DESPACHO_RECHAZO_REGISTRADO',
    source: 'rechazo_registrado',
    userId,
    userName,
  });
}

/** Venció término de respuesta → ingreso despacho fallo. */
export async function applyStageTransitionIfTerminoRespuestaVencido(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    deadlineAt?: string | null;
  },
): Promise<void> {
  if (!supportsContestacionWorkflow(opts.caseType)) return;
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  const responseStage = initialResponseTermStageForCaseType(opts.caseType);
  if (!open || open.stage_code !== responseStage) return;
  const end =
    resolveSubStageDeadline(responseStage, open.entered_at, open.metadata ?? {}, opts.caseType) ??
    (opts.deadlineAt?.trim() ? startOfLocalDay(new Date(opts.deadlineAt)) : null);
  if (!end) return;
  const today = startOfLocalDay(new Date());
  if (today.getTime() <= end.getTime()) return;

  await ensureSupabaseSessionForWrites();
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = resolveTerminoRespuestaVencidoNext(opts.caseType);
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'termino_respuesta_vencido' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[next]} (vencimiento de plazo)`,
    userId,
    userName,
    metadata: { etapa_anterior: prev, etapa_nueva: next, trigger: 'TERMINO_RESPUESTA_VENCIDO', usuario: userName },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Civil CGP: cierre del término de contestación → trámite (prueba, audiencia, autos interlocutorios). */
export async function applyStageTransitionContestacionCerrada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  if (!isCivilCaseType(opts.caseType)) return;
  await ensureSupabaseSessionForWrites();
  const responseStage = initialResponseTermStageForCaseType(opts.caseType);
  const open = requireOpenStageAt(
    await fetchOpenStageRow(supabase, opts.caseId),
    responseStage,
    'cerrar el término de contestación',
  );
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'TRAMITE';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'contestacion_cerrada' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[next]} (cierre de contestación)`,
    userId,
    userName,
    metadata: {
      etapa_anterior: prev,
      etapa_nueva: next,
      trigger: 'CONTESTACION_CERRADA',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Tutela 2ª / consulta desacato: expediente recibido (informe ingreso) → ingreso despacho / fallo. */
export async function applyStageTransitionExpedienteRecibidoAlDespacho(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    expedienteDocs?: Document[];
  },
): Promise<void> {
  if (opts.caseType !== 'tutela_segunda' && opts.caseType !== 'consulta_desacato') return;
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  if (!caseHasAnyAct(docs, ['informe_ingreso'])) {
    throw new Error(
      'Registre el informe de ingreso al despacho (PDF) en el expediente digital antes de avanzar la etapa.',
    );
  }
  await ensureSupabaseSessionForWrites();
  const open = requireOpenStageAt(
    await fetchOpenStageRow(supabase, opts.caseId),
    'RADICACION',
    'registrar ingreso del expediente al despacho',
  );
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'INGRESO_DESPACHO_FALLO';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'expediente_recibido_al_despacho' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → Ingreso despacho / fallo`,
    userId,
    userName,
    metadata: {
      etapa_anterior: prev,
      etapa_nueva: next,
      trigger: 'SECRETARIA_EXPEDIENTE_RECIBIDO_AL_DESPACHO',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });

  if (opts.caseType === 'tutela_segunda') {
    const deadlineAt = computePlazoFallarDeadlineAt('tutela_segunda', new Date());
    if (deadlineAt) {
      await supabase
        .from('cases')
        .update({ deadline_at: deadlineAt, updated_at: now })
        .eq('id', opts.caseId);
    }
  }
}

/** Despacho civil: trámite concluido → ingreso al despacho para sentencia. */
export async function applyStageTransitionIngresoDespachoParaSentencia(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  if (!isCivilCaseType(opts.caseType)) return;
  await ensureSupabaseSessionForWrites();
  const open = requireOpenStageAt(
    await fetchOpenStageRow(supabase, opts.caseId),
    'TRAMITE',
    'registrar ingreso al despacho para sentencia',
  );
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'INGRESO_DESPACHO_FALLO';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'ingreso_despacho_sentencia' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → Ingreso despacho / sentencia`,
    userId,
    userName,
    metadata: {
      etapa_anterior: prev,
      etapa_nueva: next,
      trigger: 'DESPACHO_INGRESO_SENTENCIA',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Secretaría: notificación del fallo enviada. */
export async function applyStageTransitionNotificacionFalloEnviada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    expedienteDocs?: Document[];
    /** Fecha real de notificación (día civil); por defecto hoy. */
    notifiedAt?: string | Date;
  },
): Promise<void> {
  if (!supportsNotificacionFalloWorkflow(opts.caseType)) return;
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  const gate = canRegistrarNotificacionFalloEnviada(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = requireOpenStageAt(
    await fetchOpenStageRow(supabase, opts.caseId),
    'FALLO',
    'registrar notificación del fallo',
  );
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const t0 = now;
  const notif: CaseStageCode = 'NOTIFICACION_FALLO';
  const termino: CaseStageCode = nextStageAfterNotificacionFallo(opts.caseType);
  await closeStageById(supabase, open.id, now);
  await insertCaseStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: notif,
    enteredAt: t0,
    exitedAt: t0,
    previousStageCode: 'FALLO',
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'notificacion_fallo_instantanea' },
  });
  const notifiedDay = startOfLocalDay(
    opts.notifiedAt != null ? new Date(opts.notifiedAt) : new Date(),
  );
  const terminoMetadata: Record<string, unknown> = {
    source: 'notificacion_fallo_enviada',
    notified_at: notifiedDay.toISOString(),
  };
  if (termino === 'TERMINO_IMPUGNACION') {
    Object.assign(terminoMetadata, metadataForImpugnacionDeadline(notifiedDay, opts.caseType));
  } else if (termino === 'TERMINO_APELACION') {
    Object.assign(terminoMetadata, metadataForApelacionDeadline(notifiedDay, opts.caseType));
  }
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: termino,
    enteredAt: t0,
    previousStageCode: notif,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: terminoMetadata,
  });
  await supabase.from('cases').update({ updated_at: now }).eq('id', opts.caseId);
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `Fallo → Notificación fallo → ${STAGE_LABEL_ES[termino]}`,
    userId,
    userName,
    metadata: {
      etapa_anterior: 'FALLO',
      etapa_nueva: termino,
      trigger: 'SECRETARIA_NOTIFICACION_FALLO_ENVIADA',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: termino,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: termino,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Venció término de impugnación sin impugnación registrada en app → ejecutoria. */
export async function applyStageTransitionIfTerminoImpugnacionVencido(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    deadlineAt?: string | null;
  },
): Promise<void> {
  if (opts.caseType !== 'tutela_primera') return;
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'TERMINO_IMPUGNACION') return;
  const end =
    resolveSubStageDeadline('TERMINO_IMPUGNACION', open.entered_at, open.metadata ?? {}, opts.caseType) ??
    (opts.deadlineAt?.trim() ? startOfLocalDay(new Date(opts.deadlineAt)) : null);
  if (!end) return;
  const today = startOfLocalDay(new Date());
  if (today.getTime() <= end.getTime()) return;

  await ensureSupabaseSessionForWrites();
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'EJECUTORIA';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'termino_impugnacion_vencido' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[next]} (vencimiento de plazo)`,
    userId,
    userName,
    metadata: { etapa_anterior: prev, etapa_nueva: next, trigger: 'TERMINO_IMPUGNACION_VENCIDO', usuario: userName },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Venció término de apelación sin recurso → ejecutoria (civiles CGP). */
export async function applyStageTransitionIfTerminoApelacionVencido(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    deadlineAt?: string | null;
  },
): Promise<void> {
  if (!supportsApelacionWorkflow(opts.caseType)) return;
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'TERMINO_APELACION') return;
  const end =
    resolveSubStageDeadline('TERMINO_APELACION', open.entered_at, open.metadata ?? {}, opts.caseType) ??
    (opts.deadlineAt?.trim() ? startOfLocalDay(new Date(opts.deadlineAt)) : null);
  if (!end) return;
  const today = startOfLocalDay(new Date());
  if (today.getTime() <= end.getTime()) return;

  await ensureSupabaseSessionForWrites();
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'EJECUTORIA';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'termino_apelacion_vencido' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[next]} (vencimiento de plazo)`,
    userId,
    userName,
    metadata: { etapa_anterior: prev, etapa_nueva: next, trigger: 'TERMINO_APELACION_VENCIDO', usuario: userName },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Secretaría: apelación de la sentencia recibida (civiles CGP). */
export async function applyStageTransitionApelacionRecibida(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    expedienteDocs?: Document[];
  },
): Promise<void> {
  if (!supportsApelacionWorkflow(opts.caseType)) return;
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  const gate = canRegistrarApelacionRecibida(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'TERMINO_APELACION') return;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const ape: CaseStageCode = 'APELACION';
  const rem: CaseStageCode = 'REMISION_SUPERIOR';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  const t0 = now;
  await insertCaseStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: ape,
    enteredAt: t0,
    exitedAt: t0,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'apelacion_recibida' },
  });
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: rem,
    enteredAt: t0,
    previousStageCode: ape,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'apelacion_recibida' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[ape]} → ${STAGE_LABEL_ES[rem]}`,
    userId,
    userName,
    metadata: {
      etapa_anterior: prev,
      etapa_nueva: rem,
      trigger: 'SECRETARIA_APELACION_RECIBIDA',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: rem,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: rem,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Secretaría: impugnación del fallo recibida (tutela 1ª). */
export async function applyStageTransitionImpugnacionRecibida(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    expedienteDocs?: Document[];
  },
): Promise<void> {
  if (opts.caseType !== 'tutela_primera') return;
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  const gate = canRegistrarImpugnacionRecibida(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'TERMINO_IMPUGNACION') return;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const imp: CaseStageCode = 'IMPUGNACION';
  const rem: CaseStageCode = 'REMISION_SUPERIOR';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  const t0 = now;
  await insertCaseStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: imp,
    enteredAt: t0,
    exitedAt: t0,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'impugnacion_recibida' },
  });
  const remStart = startOfLocalDay(new Date());
  const remEnd = businessDayTermEndAfterEvent(remStart, PLAZO_REMISION_EXPEDIENTE_IMPUGNACION_DIAS);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: rem,
    enteredAt: t0,
    previousStageCode: imp,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: {
      source: 'impugnacion_recibida',
      stage_deadline_at: remEnd.toISOString(),
      stage_deadline_kind: 'remision_superior',
      stage_deadline_business_days: PLAZO_REMISION_EXPEDIENTE_IMPUGNACION_DIAS,
    },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[imp]} → ${STAGE_LABEL_ES[rem]}`,
    userId,
    userName,
    metadata: {
      etapa_anterior: prev,
      etapa_nueva: rem,
      trigger: 'SECRETARIA_IMPUGNACION_RECIBIDA',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: rem,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: rem,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Secretaría: remisión al superior tras impugnación registrada. */
export async function applyStageTransitionRemisionSuperiorRegistrada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    expedienteDocs?: Document[];
  },
): Promise<void> {
  if (opts.caseType !== 'tutela_primera') return;
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId, opts.expedienteDocs);
  const gate = canRegistrarRemisionSuperior(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'REMISION_SUPERIOR') return;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'EJECUTORIA';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'remision_superior_registrada' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[next]}`,
    userId,
    userName,
    metadata: {
      etapa_anterior: prev,
      etapa_nueva: next,
      trigger: 'SECRETARIA_REMISION_SUPERIOR',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

/** Secretaría: envío a Corte registrado (solo segunda instancia). */
export async function applyStageTransitionRemisionCorteRegistrada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  if (opts.caseType !== 'tutela_segunda') return;
  const docs = await resolveExpedienteDocsForGate(supabase, opts.caseId);
  const gate = canRegistrarRemisionCorte(opts.caseType, docs);
  if (!gate.ok) throw new Error('message' in gate ? gate.message : 'Faltan piezas en el expediente.');
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'EJECUTORIA') return;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const next: CaseStageCode = 'REMISION_CORTE';
  const prev = open.stage_code as CaseStageCode;
  await closeStageById(supabase, open.id, now);
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: next,
    enteredAt: now,
    previousStageCode: prev,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'remision_corte' },
  });
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_AUTOMATICO',
    description: `${STAGE_LABEL_ES[prev]} → ${STAGE_LABEL_ES[next]}`,
    userId,
    userName,
    metadata: {
      etapa_anterior: prev,
      etapa_nueva: next,
      trigger: 'SECRETARIA_REMISION_CORTE',
      usuario: userName,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: next,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: next,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

export async function runAutomaticStageChecksOnCaseLoad(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    deadlineAt?: string | null;
  },
): Promise<void> {
  try {
    await applyStageTransitionIfTerminoRespuestaVencido(supabase, opts);
    await applyStageTransitionIfTerminoImpugnacionVencido(supabase, opts);
    await applyStageTransitionIfTerminoApelacionVencido(supabase, opts);
  } catch (e) {
    console.error('runAutomaticStageChecksOnCaseLoad:', e);
  }
}

export async function manualStageGoBack(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    motivo: string;
  },
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const pipeline = [...pipelineForCaseType(opts.caseType)];
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open?.stage_code) throw new Error('No hay etapa abierta.');
  const cur = open.stage_code as CaseStageCode;
  const idx = pipeline.indexOf(cur);
  if (idx <= 0) throw new Error('No hay etapa anterior en el carril.');
  const target = pipeline[idx - 1]!;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();

  await closeStageById(supabase, open.id, now);

  const { data: prevRows, error: qe } = await supabase
    .from('case_stages')
    .select('id, exited_at')
    .eq('case_id', opts.caseId)
    .eq('stage_code', target)
    .not('exited_at', 'is', null)
    .order('exited_at', { ascending: false })
    .limit(1);
  if (qe) throw qe;
  const prevId = prevRows?.[0]?.id as string | undefined;
  if (prevId) {
    const { error: upr } = await supabase.from('case_stages').update({ exited_at: null }).eq('id', prevId);
    if (upr) throw upr;
  } else {
    await insertOpenStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      stage: target,
      enteredAt: now,
      previousStageCode: cur,
      createdBy: userId,
      caseType: opts.caseType,
      metadata: { source: 'manual_retroceso', reopened: true },
    });
  }

  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_MANUAL',
    description: `Retroceso: ${stageLabelForCaseType(cur, opts.caseType)} → ${stageLabelForCaseType(target, opts.caseType)}`,
    userId,
    userName,
    metadata: {
      motivo: opts.motivo,
      etapa_anterior: cur,
      etapa_nueva: target,
      usuario: userName,
      accion: 'retroceder',
    },
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: target,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

export async function manualStageSkipTo(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
    dest: CaseStageCode;
    motivo: string;
  },
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const pipeline = [...pipelineForCaseType(opts.caseType)];
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open?.stage_code) throw new Error('No hay etapa abierta.');
  const cur = open.stage_code as CaseStageCode;
  const i0 = pipeline.indexOf(cur);
  const i1 = pipeline.indexOf(opts.dest);
  if (i1 < 0) throw new Error('Etapa destino no válida para este tipo de asunto.');
  if (i1 <= i0) throw new Error('El salto debe ser hacia adelante en el carril.');
  const intermediates = pipeline.slice(i0 + 1, i1);
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  await closeStageById(supabase, open.id, now);

  for (const code of intermediates) {
    await insertCaseStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      stage: code as CaseStageCode,
      enteredAt: now,
      exitedAt: now,
      previousStageCode: cur,
      createdBy: userId,
      caseType: opts.caseType,
      metadata: { omitida: true, source: 'manual_salto' },
    });
  }

  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: opts.dest,
    enteredAt: now,
    previousStageCode: cur,
    createdBy: userId,
    caseType: opts.caseType,
    metadata: { source: 'manual_salto' },
  });

  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_MANUAL',
    description: `Salto: ${stageLabelForCaseType(cur, opts.caseType)} → ${stageLabelForCaseType(opts.dest, opts.caseType)}`,
    userId,
    userName,
    metadata: {
      motivo: opts.motivo,
      etapa_anterior: cur,
      etapa_nueva: opts.dest,
      usuario: userName,
      accion: 'saltar',
      etapas_omitidas: intermediates,
    },
  });
  await insertWorkflowStageEntryNotifications(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    enteredStage: opts.dest,
  });
  await enqueueWorkflowTaskForStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: opts.dest,
    creatorId: userId,
    caseAssignedTo: opts.caseAssignedTo,
  });
}

export async function manualStageEditEnteredAt(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    stageRowId: string;
    newEnteredAtIso: string;
    motivo: string;
  },
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const { data: row, error: fe } = await supabase
    .from('case_stages')
    .select('id, stage_code, entered_at')
    .eq('id', opts.stageRowId)
    .eq('case_id', opts.caseId)
    .maybeSingle();
  if (fe || !row) throw new Error('Etapa no encontrada.');
  const oldEntered = String((row as { entered_at: string }).entered_at);
  const { userId, userName } = await authActor(supabase);
  const { error: up } = await supabase
    .from('case_stages')
    .update({ entered_at: opts.newEnteredAtIso })
    .eq('id', opts.stageRowId);
  if (up) throw up;
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_MANUAL',
    description: `Ajuste de fecha de entrada (${(row as { stage_code: string }).stage_code})`,
    userId,
    userName,
    metadata: {
      motivo: opts.motivo,
      etapa_anterior: null,
      etapa_nueva: null,
      usuario: userName,
      accion: 'editar_fecha_entrada',
      stage_row_id: opts.stageRowId,
      fecha_original: oldEntered,
      fecha_nueva: opts.newEnteredAtIso,
    },
  });
}
