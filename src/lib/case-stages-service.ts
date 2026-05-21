import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaseType, UserRole } from '../types';
import { startOfLocalDay } from './business-days';
import {
  metadataForContestacionDeadline,
  metadataForImpugnacionDeadline,
  resolveSubStageDeadline,
} from './case-stage-deadlines';
import {
  pipelineForCaseType,
  responsibleRoleForStage,
  resolveWorkflowAssigneeId,
  STAGE_LABEL_ES,
  workflowTaskPayloadForStage,
  type CaseStageCode,
} from './case-workflow-stages';
import { insertWorkflowStageEntryNotifications } from './workflow-stage-notifications';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';

export type CaseStageRowDb = {
  id: string;
  stage_code: string;
  responsible_role: string | null;
  entered_at: string;
  exited_at: string | null;
  metadata?: Record<string, unknown> | null;
};

export function canManualManageCaseStages(role: UserRole | null | undefined): boolean {
  return role === 'judge' || role === 'clerk' || role === 'admin';
}

export function canEditStageEnteredAt(role: UserRole | null | undefined): boolean {
  return role === 'judge' || role === 'clerk' || role === 'admin';
}

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
  },
): Promise<void> {
  const rr = responsibleRoleForStage(opts.stage);
  const { error } = await supabase.from('case_stages').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    stage_code: opts.stage,
    responsible_role: rr,
    entered_at: opts.enteredAt,
    previous_stage_code: opts.previousStageCode ?? null,
    created_by: opts.createdBy,
    metadata: opts.metadata ?? {},
  });
  if (error) throw error;
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
  const rr = responsibleRoleForStage(first);
  const { error: insErr } = await supabase.from('case_stages').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    stage_code: first,
    responsible_role: rr,
    entered_at: now,
    created_by: userId,
    metadata: { source: 'radicacion' },
  });
  if (insErr) {
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
  await ensureSupabaseSessionForWrites();
  const { userId, userName } = await authActor(supabase);
  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'REGISTRO_INTERNO_REVISION',
    description: `Borrador del auto admisorio enviado a revisión${opts.documentLabel ? `: ${opts.documentLabel}` : ''}`,
    userId,
    userName,
    metadata: { trigger: 'BORRADOR_AUTO_ENVIADO_REVISION' },
  });
}

function isBorradorAutoAdmisorioDocType(t: string | undefined): boolean {
  return t === 'borrador_auto_admisorio_revision';
}

function isBorradorFalloDocType(t: string | undefined): boolean {
  if (!t) return false;
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

  if (opts.caseType === 'tutela_primera' && isBorradorAutoAdmisorioDocType(opts.wordDocumentType)) {
    if (current !== 'RADICACION') return;
    const next: CaseStageCode = 'ADMISION';
    await closeStageById(supabase, open.id, now);
    await insertOpenStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      stage: next,
      enteredAt: now,
      previousStageCode: current,
      createdBy: userId,
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

  if (isBorradorFalloDocType(opts.wordDocumentType)) {
    if (current !== 'INGRESO_DESPACHO_FALLO') return;
    const next: CaseStageCode = 'FALLO';
    await closeStageById(supabase, open.id, now);
    await insertOpenStage(supabase, {
      courtId: opts.courtId,
      caseId: opts.caseId,
      stage: next,
      enteredAt: now,
      previousStageCode: current,
      createdBy: userId,
      metadata: { source: 'juez_aprueba_borrador_fallo' },
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
        trigger: 'JUEZ_APROBO_BORRADOR_FALLO',
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
}

/** Secretaría: notificación del auto admisorio enviada (solo tutela primera). */
export async function applyStageTransitionNotificacionAutoEnviada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  if (opts.caseType !== 'tutela_primera') return;
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'ADMISION') return;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const t0 = new Date().toISOString();
  const notif: CaseStageCode = 'NOTIFICACION_AUTO_ADMISORIO';
  const termino: CaseStageCode = 'TERMINO_RESPUESTA';

  await closeStageById(supabase, open.id, now);
  await supabase.from('case_stages').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    stage_code: notif,
    responsible_role: responsibleRoleForStage(notif),
    entered_at: t0,
    exited_at: t0,
    previous_stage_code: 'ADMISION',
    created_by: userId,
    metadata: { source: 'notificacion_auto_instantanea' },
  });
  const notifiedDay = startOfLocalDay(new Date());
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: termino,
    enteredAt: t0,
    previousStageCode: notif,
    createdBy: userId,
    metadata: {
      source: 'notificacion_auto_enviada',
      notified_at: t0,
      ...metadataForContestacionDeadline(notifiedDay),
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
  if (opts.caseType !== 'tutela_primera') return;
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'TERMINO_RESPUESTA') return;
  const end =
    resolveSubStageDeadline('TERMINO_RESPUESTA', open.entered_at, open.metadata ?? {}) ??
    (opts.deadlineAt?.trim() ? startOfLocalDay(new Date(opts.deadlineAt)) : null);
  if (!end) return;
  const today = startOfLocalDay(new Date());
  if (today.getTime() <= end.getTime()) return;

  await ensureSupabaseSessionForWrites();
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

/** Secretaría: notificación del fallo enviada. */
export async function applyStageTransitionNotificacionFalloEnviada(
  supabase: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    caseType: CaseType;
    caseAssignedTo?: string | null;
  },
): Promise<void> {
  if (opts.caseType !== 'tutela_primera') return;
  await ensureSupabaseSessionForWrites();
  const open = await fetchOpenStageRow(supabase, opts.caseId);
  if (!open || open.stage_code !== 'FALLO') return;
  const { userId, userName } = await authActor(supabase);
  const now = new Date().toISOString();
  const t0 = now;
  const notif: CaseStageCode = 'NOTIFICACION_FALLO';
  const termino: CaseStageCode = 'TERMINO_IMPUGNACION';
  await closeStageById(supabase, open.id, now);
  await supabase.from('case_stages').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    stage_code: notif,
    responsible_role: responsibleRoleForStage(notif),
    entered_at: t0,
    exited_at: t0,
    previous_stage_code: 'FALLO',
    created_by: userId,
    metadata: { source: 'notificacion_fallo_instantanea' },
  });
  const notifiedDay = startOfLocalDay(new Date());
  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: termino,
    enteredAt: t0,
    previousStageCode: notif,
    createdBy: userId,
    metadata: {
      source: 'notificacion_fallo_enviada',
      notified_at: t0,
      ...metadataForImpugnacionDeadline(notifiedDay),
    },
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
    resolveSubStageDeadline('TERMINO_IMPUGNACION', open.entered_at, open.metadata ?? {}) ??
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

/** Secretaría: envío a Corte registrado. */
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
  if (opts.caseType !== 'tutela_primera') return;
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
      metadata: { source: 'manual_retroceso', reopened: true },
    });
  }

  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_MANUAL',
    description: `Retroceso: ${STAGE_LABEL_ES[cur]} → ${STAGE_LABEL_ES[target]}`,
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
    const { error } = await supabase.from('case_stages').insert({
      court_id: opts.courtId,
      case_id: opts.caseId,
      stage_code: code,
      responsible_role: responsibleRoleForStage(code as CaseStageCode),
      entered_at: now,
      exited_at: now,
      previous_stage_code: cur,
      created_by: userId,
      metadata: { omitida: true, source: 'manual_salto' },
    });
    if (error) throw error;
  }

  await insertOpenStage(supabase, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: opts.dest,
    enteredAt: now,
    previousStageCode: cur,
    createdBy: userId,
    metadata: { source: 'manual_salto' },
  });

  await insertCaseAction(supabase, {
    caseId: opts.caseId,
    type: 'CAMBIO_ETAPA_MANUAL',
    description: `Salto: ${STAGE_LABEL_ES[cur]} → ${STAGE_LABEL_ES[opts.dest]}`,
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
