/**
 * Recorrido E2E tutela primera instancia con bots de rol.
 * Usa los .eml de Descargas, radica la tutela válida y avanza hasta notificación del auto admisorio.
 *
 * Uso:
 *   npm run bots:e2e-tutela
 *   npm run bots:e2e-tutela -- "C:\Users\...\correo.eml"
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { parseJudicialEmailFromBuffer } from '../server/parse-judicial-email.ts';
import { parseSegundaInstanciaFromEmail } from '../server/sgde-segunda-instancia-parse.ts';
import {
  uploadCaseAttachment,
  insertCaseDocumentRows,
  insertCaseDocumentRowReturningId,
  base64ToUint8Array,
} from '../src/lib/case-document-storage.ts';
import {
  businessDayTermEnd,
  startOfLocalDay,
  CONTESTACION_BUSINESS_DAYS,
  IMPUGNACION_BUSINESS_DAYS,
} from '../src/lib/business-days.ts';
import { caseTermBusinessDaysFromDecreto2591 } from '../src/lib/decreto-2591-plazos.ts';
import { buildRadicadoPrimeraInstancia } from '../src/lib/radicado-cui.ts';
import { DEFAULT_NOTEBOOK_CODE } from '../src/lib/expediente-notebook.ts';
import type { CaseStageCode } from '../src/lib/case-workflow-stages.ts';
import type { UserRole } from '../src/types.ts';

const STAGE_LABEL_ES: Record<CaseStageCode, string> = {
  RADICACION: 'Radicación',
  ADMISION: 'Admisión',
  INADMISION: 'Inadmisión',
  RECHAZO: 'Rechazo',
  NOTIFICACION_AUTO_ADMISORIO: 'Notificación auto admisorio',
  TERMINO_RESPUESTA: 'Término de respuesta',
  INGRESO_DESPACHO_FALLO: 'Ingreso despacho / fallo',
  FALLO: 'Fallo',
  NOTIFICACION_FALLO: 'Notificación del fallo',
  TERMINO_IMPUGNACION: 'Término de impugnación',
  IMPUGNACION: 'Impugnación',
  REMISION_SUPERIOR: 'Remisión superior',
  EJECUTORIA: 'Ejecutoria',
  REMISION_CORTE: 'Remisión a Corte',
  CUMPLIMIENTO: 'Cumplimiento',
  INCIDENTE_DESACATO: 'Incidente de desacato',
};

function responsibleRoleForStage(stage: CaseStageCode): 'secretaria' | 'despacho' {
  const despacho = new Set<CaseStageCode>(['ADMISION', 'INGRESO_DESPACHO_FALLO', 'FALLO', 'EJECUTORIA']);
  return despacho.has(stage) ? 'despacho' : 'secretaria';
}

function metadataForContestacionDeadline(notifiedOn: Date): Record<string, unknown> {
  const end = businessDayTermEnd(startOfLocalDay(notifiedOn), CONTESTACION_BUSINESS_DAYS);
  return {
    stage_deadline_at: end.toISOString(),
    stage_deadline_kind: 'contestacion_accionados',
    stage_deadline_business_days: CONTESTACION_BUSINESS_DAYS,
  };
}

function metadataForImpugnacionDeadline(notifiedOn: Date): Record<string, unknown> {
  const end = businessDayTermEnd(startOfLocalDay(notifiedOn), IMPUGNACION_BUSINESS_DAYS);
  return {
    stage_deadline_at: end.toISOString(),
    stage_deadline_kind: 'impugnacion',
    stage_deadline_business_days: IMPUGNACION_BUSINESS_DAYS,
  };
}

async function notifyStageEntry(
  admin: SupabaseClient,
  opts: { courtId: string; caseId: string; radicado: string; stage: CaseStageCode },
) {
  const rolesByStage: Partial<Record<CaseStageCode, UserRole[]>> = {
    ADMISION: ['clerk', 'escribiente', 'official'],
    TERMINO_RESPUESTA: ['sustanciador'],
    INGRESO_DESPACHO_FALLO: ['sustanciador'],
    FALLO: ['clerk', 'escribiente', 'official'],
    TERMINO_IMPUGNACION: ['clerk', 'escribiente', 'official'],
  };
  const roles = rolesByStage[opts.stage];
  if (!roles?.length) return;
  const { data: profiles } = await admin.from('profiles').select('id').eq('court_id', opts.courtId).in('role', roles);
  const titles: Partial<Record<CaseStageCode, string>> = {
    ADMISION: `Auto admisorio firmado — ${opts.radicado} — Generar oficios`,
    TERMINO_RESPUESTA: `Plazo contestación — ${opts.radicado}`,
    INGRESO_DESPACHO_FALLO: `Expediente listo para fallo — ${opts.radicado}`,
    FALLO: `Fallo firmado — ${opts.radicado} — Generar oficios de notificación`,
    TERMINO_IMPUGNACION: `Plazo impugnación (3 días háb.) — ${opts.radicado}`,
  };
  const title = titles[opts.stage] ?? `Etapa ${opts.stage} — ${opts.radicado}`;
  for (const p of profiles ?? []) {
    await admin.from('user_notifications').insert({
      court_id: opts.courtId,
      case_id: opts.caseId,
      recipient_user_id: p.id,
      kind: `workflow_${opts.stage.toLowerCase()}`,
      title,
      body: 'Generado por bots E2E.',
      metadata: { radicado: opts.radicado, stage_code: opts.stage },
    });
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_EMLS = [
  'C:\\Users\\USUARIO\\Downloads\\RV_ Generación de Tutela en línea No 3908971.eml',
  'C:\\Users\\USUARIO\\Downloads\\RV_ Generación de la Demanda en línea No 1699682.eml',
  'C:\\Users\\USUARIO\\Downloads\\RV_ NOTIFICACIÓN AUTO CONCEDE IMPUGNACIÓN 11001418907020260090400.eml',
] as const;

const BOT_PASSWORD = '123456';
const COURT_ID = 'court-1';

type BotKey = 'secretario' | 'sustanciador' | 'juez' | 'escribiente';

const BOT_EMAILS: Record<BotKey, string> = {
  secretario: 'bot.secretario@tutelia-despacho.seed',
  sustanciador: 'bot.sustanciador@tutelia-despacho.seed',
  juez: 'bot.juez@tutelia-despacho.seed',
  escribiente: 'bot.escribiente@tutelia-despacho.seed',
};

type StepLog = { bot: string; step: string; ok: boolean; detail?: string };

function loadEnv() {
  for (const name of ['.env', '.env.local'] as const) {
    const full = path.join(projectRoot, name);
    if (fs.existsSync(full)) dotenv.config({ path: full });
  }
}

function normalizeUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s;
}

function logStep(steps: StepLog[], bot: string, step: string, ok: boolean, detail?: string) {
  steps.push({ bot, step, ok, detail });
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} [${bot}] ${step}${detail ? ` — ${detail}` : ''}`);
}

async function authUserId(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (error || !data?.id) throw new Error(`Perfil no encontrado para ${email}. Ejecute npm run seed:role-bots`);
  return data.id as string;
}

async function minimalDocxBytes(title: string): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: title, bold: true })],
          }),
          new Paragraph({
            children: [new TextRun('Borrador generado por bot E2E — Tutelia.')],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function fetchOpenStage(admin: SupabaseClient, caseId: string) {
  const { data } = await admin
    .from('case_stages')
    .select('id, stage_code, entered_at, metadata')
    .eq('case_id', caseId)
    .is('exited_at', null)
    .maybeSingle();
  return data as { id: string; stage_code: string; entered_at: string; metadata: Record<string, unknown> | null } | null;
}

async function closeStage(admin: SupabaseClient, stageId: string, exitedAt: string) {
  const { error } = await admin.from('case_stages').update({ exited_at: exitedAt }).eq('id', stageId);
  if (error) throw error;
}

async function insertStage(
  admin: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    stage: CaseStageCode;
    enteredAt: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
    exitedAt?: string | null;
    previous?: CaseStageCode;
  },
) {
  const { error } = await admin.from('case_stages').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    stage_code: opts.stage,
    responsible_role: responsibleRoleForStage(opts.stage),
    entered_at: opts.enteredAt,
    exited_at: opts.exitedAt ?? null,
    metadata: {
      ...(opts.metadata ?? {}),
      case_stage_code: opts.stage,
      responsible_role: responsibleRoleForStage(opts.stage),
      ...(opts.previous ? { previous_stage_code: opts.previous } : {}),
    },
    created_by: opts.createdBy,
  });
  if (error) throw error;
}

async function enqueueTask(
  admin: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    radicado: string;
    stage: CaseStageCode;
    creatorId: string;
  },
) {
  const rr = responsibleRoleForStage(opts.stage);
  const roles = rr === 'despacho' ? (['judge', 'sustanciador'] as UserRole[]) : (['clerk', 'escribiente'] as UserRole[]);
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, role')
    .eq('court_id', opts.courtId)
    .in('role', roles)
    .order('name');
  const assigneeId = profiles?.[0]?.id;
  if (!assigneeId) return;
  const title =
    opts.stage === 'ADMISION' || opts.stage === 'FALLO'
      ? `Generar oficios — ${opts.radicado}`
      : `Trámite: ${STAGE_LABEL_ES[opts.stage]}`;
  await admin.from('workflow_tasks').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    radicado: opts.radicado,
    title,
    description: title,
    assignee_id: assigneeId,
    creator_id: opts.creatorId,
    status: 'pending',
    priority: 'medium',
    task_type: opts.stage === 'ADMISION' || opts.stage === 'FALLO' ? 'generate_notifs' : 'custom',
    metadata: { case_stage_code: opts.stage, responsible_role: rr },
  });
}

async function analyzeEml(emlPath: string) {
  const buf = fs.readFileSync(emlPath);
  const parsed = await parseJudicialEmailFromBuffer(buf);
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const si = parseSegundaInstanciaFromEmail(String(parsed.subject || ''), text, html);
  return { path: emlPath, parsed, si, size: buf.length };
}

async function nextConsecutive(admin: SupabaseClient, courtId: string): Promise<number> {
  const year = new Date().getFullYear();
  const prefix = '110013105051'; // court-1 demo: 11001 + 31 + 05 + 051
  const { data } = await admin
    .from('cases')
    .select('radicado')
    .eq('court_id', courtId)
    .like('radicado', `${prefix}${year}%`);
  let max = 0;
  for (const row of data ?? []) {
    const d = String(row.radicado ?? '').replace(/\D/g, '');
    if (d.length === 23 && d.startsWith(`${prefix}${year}`)) {
      const n = parseInt(d.slice(16, 21), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}

async function radicarDesdeTutelaEml(
  admin: SupabaseClient,
  emlAnalysis: Awaited<ReturnType<typeof analyzeEml>>,
  secretarioId: string,
  steps: StepLog[],
): Promise<{ caseId: string; radicado: string }> {
  const { parsed } = emlAnalysis;
  const courtId = COURT_ID;
  const cons = await nextConsecutive(admin, courtId);
  const radicado = buildRadicadoPrimeraInstancia(String(cons), {
    cityCode: '11001',
    entityCode: '31',
    specialtyCode: '05',
    despachoCode: '051',
  });
  const caseId = randomUUID();
  const filing = startOfLocalDay(new Date());
  const deadlineAt = businessDayTermEnd(filing, caseTermBusinessDaysFromDecreto2591('tutela_primera')).toISOString();

  const { error: insErr } = await admin.from('cases').insert({
    id: caseId,
    court_id: courtId,
    radicado,
    deadline_at: deadlineAt,
    claimant: parsed.from || 'Accionante E2E',
    defendant: 'Entidad accionada E2E',
    status: 'received',
    source_channel: 'email',
    subject: parsed.subject || 'Tutela E2E bot',
    raw_text: typeof parsed.text === 'string' ? parsed.text : '',
    case_type: 'tutela_primera',
    assigned_to: 'Bot Sustanciador',
  });
  if (insErr) throw insErr;
  logStep(steps, 'Bot Secretario', 'Radicar tutela primera instancia', true, radicado);

  const docRows: Record<string, unknown>[] = [];
  let sort = 0;
  for (const att of parsed.attachments ?? []) {
    if (!att.content) continue;
    try {
      const bytes = base64ToUint8Array(att.content);
      const up = await uploadCaseAttachment(
        admin,
        caseId,
        att.filename || 'adjunto.pdf',
        bytes,
        att.contentType || 'application/pdf',
      );
      if ('error' in up) {
        logStep(steps, 'Bot Secretario', `Subir adjunto ${att.filename}`, false, up.error.message);
        continue;
      }
      docRows.push({
        case_id: caseId,
        name: att.filename,
        original_name: att.originalName || att.filename,
        type: 'attachment',
        content_type: att.contentType,
        size: att.size ?? bytes.byteLength,
        storage_path: up.path,
        is_from_link: !!att.isFromLink,
        sort_order: sort++,
        notebook_code: DEFAULT_NOTEBOOK_CODE,
      });
    } catch (e) {
      logStep(steps, 'Bot Secretario', `Adjunto ${att.filename}`, false, String(e));
    }
  }
  if (docRows.length) {
    await insertCaseDocumentRows(admin, docRows);
    logStep(steps, 'Bot Secretario', 'Cargar piezas al expediente', true, `${docRows.length} documento(s)`);
  } else {
    logStep(steps, 'Bot Secretario', 'Cargar piezas al expediente', false, 'Sin adjuntos persistidos en sesión parse');
  }

  const now = new Date().toISOString();
  await insertStage(admin, {
    courtId,
    caseId,
    stage: 'RADICACION',
    enteredAt: now,
    createdBy: secretarioId,
    metadata: { source: 'radicacion', bot_e2e: true },
  });
  await enqueueTask(admin, {
    courtId,
    caseId,
    radicado,
    stage: 'RADICACION',
    creatorId: secretarioId,
  });
  logStep(steps, 'Bot Secretario', 'Abrir etapa RADICACION', true);

  return { caseId, radicado };
}

async function sustanciadorEnviaAuto(
  admin: SupabaseClient,
  opts: { caseId: string; courtId: string; radicado: string; sustanciadorId: string },
  steps: StepLog[],
): Promise<string> {
  const docx = await minimalDocxBytes(`Auto admisorio — ${opts.radicado}`);
  const name = `AutoAdmisorio${opts.radicado.slice(-5)}.docx`;
  const up = await uploadCaseAttachment(admin, opts.caseId, name, docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if ('error' in up) throw up.error;

  const { id: documentId } = await insertCaseDocumentRowReturningId(admin, {
    case_id: opts.caseId,
    name,
    original_name: name,
    type: 'borrador_auto_admisorio_revision',
    content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: docx.byteLength,
    storage_path: up.path,
    is_from_link: false,
    sort_order: 99,
    notebook_code: DEFAULT_NOTEBOOK_CODE,
  });

  const now = new Date().toISOString();
  const { data: review, error } = await admin
    .from('case_word_reviews')
    .insert({
      case_id: opts.caseId,
      word_document_id: documentId,
      status: 'pendiente_juez',
      created_by: opts.sustanciadorId,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (error) throw error;
  logStep(steps, 'Bot Sustanciador', 'Enviar auto admisorio a revisión del juez', true, review.id as string);
  return review.id as string;
}

async function juezApruebaAuto(
  admin: SupabaseClient,
  opts: {
    caseId: string;
    courtId: string;
    radicado: string;
    reviewId: string;
    juezId: string;
    assignedTo?: string | null;
  },
  steps: StepLog[],
) {
  const now = new Date().toISOString();
  await admin
    .from('case_word_reviews')
    .update({ status: 'aprobado_firma_pendiente', updated_at: now })
    .eq('id', opts.reviewId);

  const open = await fetchOpenStage(admin, opts.caseId);
  if (!open || open.stage_code !== 'RADICACION') {
    logStep(steps, 'Bot Juez', 'Aprobar auto → ADMISION', false, `Etapa abierta: ${open?.stage_code ?? 'ninguna'}`);
    return;
  }
  await closeStage(admin, open.id, now);
  await insertStage(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'ADMISION',
    enteredAt: now,
    createdBy: opts.juezId,
    previous: 'RADICACION',
    metadata: { source: 'juez_aprueba_auto_admisorio', bot_e2e: true },
  });
  await notifyStageEntry(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'ADMISION',
  });
  await enqueueTask(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'ADMISION',
    creatorId: opts.juezId,
  });
  logStep(steps, 'Bot Juez', 'Aprobar borrador → etapa ADMISION', true);
}

async function escribienteNotificaAuto(
  admin: SupabaseClient,
  opts: { caseId: string; courtId: string; radicado: string; escribienteId: string; assignedTo?: string | null },
  steps: StepLog[],
) {
  const open = await fetchOpenStage(admin, opts.caseId);
  if (!open || open.stage_code !== 'ADMISION') {
    logStep(steps, 'Bot Escribiente', 'Registrar notificación auto admisorio', false, `Etapa: ${open?.stage_code ?? '—'}`);
    return;
  }
  const now = new Date().toISOString();
  await closeStage(admin, open.id, now);
  await insertStage(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'NOTIFICACION_AUTO_ADMISORIO',
    enteredAt: now,
    exitedAt: now,
    createdBy: opts.escribienteId,
    previous: 'ADMISION',
    metadata: { source: 'notificacion_auto_instantanea', bot_e2e: true },
  });
  const notifiedDay = startOfLocalDay(new Date());
  await insertStage(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'TERMINO_RESPUESTA',
    enteredAt: now,
    createdBy: opts.escribienteId,
    previous: 'NOTIFICACION_AUTO_ADMISORIO',
    metadata: {
      source: 'notificacion_auto_enviada',
      notified_at: now,
      ...metadataForContestacionDeadline(notifiedDay),
    },
  });
  await notifyStageEntry(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'TERMINO_RESPUESTA',
  });
  await enqueueTask(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'TERMINO_RESPUESTA',
    creatorId: opts.escribienteId,
  });
  logStep(
    steps,
    'Bot Escribiente',
    'Registrar notificación auto admisorio enviada',
    true,
    `→ ${STAGE_LABEL_ES.TERMINO_RESPUESTA}`,
  );
}

/** Simula vencimiento del plazo de contestación (2 días háb.) → ingreso despacho / fallo. */
async function forzarTerminoRespuestaVencido(
  admin: SupabaseClient,
  opts: { caseId: string; courtId: string; radicado: string; sustanciadorId: string },
  steps: StepLog[],
) {
  const open = await fetchOpenStage(admin, opts.caseId);
  if (!open || open.stage_code !== 'TERMINO_RESPUESTA') {
    logStep(steps, 'Bot Sustanciador', 'Forzar vencimiento contestación', false, `Etapa: ${open?.stage_code ?? '—'}`);
    return;
  }
  const now = new Date().toISOString();
  await closeStage(admin, open.id, now);
  await insertStage(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'INGRESO_DESPACHO_FALLO',
    enteredAt: now,
    createdBy: opts.sustanciadorId,
    previous: 'TERMINO_RESPUESTA',
    metadata: { source: 'termino_respuesta_vencido', bot_e2e: true, forced: true },
  });
  await notifyStageEntry(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'INGRESO_DESPACHO_FALLO',
  });
  await enqueueTask(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'INGRESO_DESPACHO_FALLO',
    creatorId: opts.sustanciadorId,
  });
  logStep(steps, 'Bot Sustanciador', 'Plazo contestación vencido (simulado)', true, '→ Ingreso despacho / fallo');
}

async function sustanciadorEnviaFallo(
  admin: SupabaseClient,
  opts: { caseId: string; courtId: string; radicado: string; sustanciadorId: string },
  steps: StepLog[],
): Promise<string> {
  const docx = await minimalDocxBytes(`Fallo tutela — ${opts.radicado}`);
  const name = `Fallo${opts.radicado.slice(-5)}.docx`;
  const up = await uploadCaseAttachment(admin, opts.caseId, name, docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if ('error' in up) throw up.error;

  const { id: documentId } = await insertCaseDocumentRowReturningId(admin, {
    case_id: opts.caseId,
    name,
    original_name: name,
    type: 'borrador_fallo_revision',
    content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: docx.byteLength,
    storage_path: up.path,
    is_from_link: false,
    sort_order: 100,
    notebook_code: DEFAULT_NOTEBOOK_CODE,
  });

  const now = new Date().toISOString();
  const { data: review, error } = await admin
    .from('case_word_reviews')
    .insert({
      case_id: opts.caseId,
      word_document_id: documentId,
      status: 'pendiente_juez',
      created_by: opts.sustanciadorId,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (error) throw error;
  logStep(steps, 'Bot Sustanciador', 'Enviar borrador de fallo a revisión del juez', true, review.id as string);
  return review.id as string;
}

async function juezApruebaFallo(
  admin: SupabaseClient,
  opts: { caseId: string; courtId: string; radicado: string; reviewId: string; juezId: string },
  steps: StepLog[],
) {
  const now = new Date().toISOString();
  await admin
    .from('case_word_reviews')
    .update({ status: 'aprobado_firma_pendiente', updated_at: now })
    .eq('id', opts.reviewId);

  const open = await fetchOpenStage(admin, opts.caseId);
  if (!open || open.stage_code !== 'INGRESO_DESPACHO_FALLO') {
    logStep(steps, 'Bot Juez', 'Aprobar fallo → FALLO', false, `Etapa abierta: ${open?.stage_code ?? 'ninguna'}`);
    return;
  }
  await closeStage(admin, open.id, now);
  await insertStage(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'FALLO',
    enteredAt: now,
    createdBy: opts.juezId,
    previous: 'INGRESO_DESPACHO_FALLO',
    metadata: { source: 'juez_aprueba_borrador_fallo', bot_e2e: true },
  });
  await notifyStageEntry(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'FALLO',
  });
  await enqueueTask(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'FALLO',
    creatorId: opts.juezId,
  });
  logStep(steps, 'Bot Juez', 'Aprobar borrador de fallo → etapa FALLO', true);
}

async function escribienteNotificaFallo(
  admin: SupabaseClient,
  opts: { caseId: string; courtId: string; radicado: string; escribienteId: string },
  steps: StepLog[],
) {
  const open = await fetchOpenStage(admin, opts.caseId);
  if (!open || open.stage_code !== 'FALLO') {
    logStep(steps, 'Bot Escribiente', 'Registrar notificación del fallo', false, `Etapa: ${open?.stage_code ?? '—'}`);
    return;
  }
  const now = new Date().toISOString();
  await closeStage(admin, open.id, now);
  await insertStage(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'NOTIFICACION_FALLO',
    enteredAt: now,
    exitedAt: now,
    createdBy: opts.escribienteId,
    previous: 'FALLO',
    metadata: { source: 'notificacion_fallo_instantanea', bot_e2e: true },
  });
  const notifiedDay = startOfLocalDay(new Date());
  await insertStage(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    stage: 'TERMINO_IMPUGNACION',
    enteredAt: now,
    createdBy: opts.escribienteId,
    previous: 'NOTIFICACION_FALLO',
    metadata: {
      source: 'notificacion_fallo_enviada',
      notified_at: now,
      ...metadataForImpugnacionDeadline(notifiedDay),
    },
  });
  await notifyStageEntry(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'TERMINO_IMPUGNACION',
  });
  await enqueueTask(admin, {
    courtId: opts.courtId,
    caseId: opts.caseId,
    radicado: opts.radicado,
    stage: 'TERMINO_IMPUGNACION',
    creatorId: opts.escribienteId,
  });
  logStep(
    steps,
    'Bot Escribiente',
    'Registrar notificación del fallo enviada',
    true,
    `→ ${STAGE_LABEL_ES.TERMINO_IMPUGNACION}`,
  );
}

async function main() {
  loadEnv();
  const url = normalizeUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const steps: StepLog[] = [];
  const inconvenientes: string[] = [];

  const emlPaths = process.argv.slice(2).length ? process.argv.slice(2) : [...DEFAULT_EMLS];

  console.log('='.repeat(72));
  console.log('E2E BOTS — Tutela completa hasta notificación del fallo');
  console.log('='.repeat(72));

  console.log('\n--- Análisis de los correos descargados ---\n');
  const analyses: Awaited<ReturnType<typeof analyzeEml>>[] = [];
  for (const p of emlPaths) {
    if (!fs.existsSync(p)) {
      console.log(`✗ No existe: ${p}`);
      inconvenientes.push(`Archivo no encontrado: ${p}`);
      continue;
    }
    const a = await analyzeEml(p);
    analyses.push(a);
    const isTutelaGen = /generaci[oó]n de tutela/i.test(String(a.parsed.subject));
    const isDemandaCivil = /demanda en l[ií]nea/i.test(String(a.parsed.subject));
    const isNotifImpugnacion = /notificaci[oó]n.*impugnaci[oó]n/i.test(String(a.parsed.subject));
    console.log(`📧 ${path.basename(p)}`);
    console.log(`   Asunto: ${a.parsed.subject}`);
    console.log(`   De: ${a.parsed.from}`);
    console.log(`   Adjuntos parseados: ${a.parsed.attachments?.length ?? 0} | Enlace Archivo: ${a.parsed.linkFound ? 'sí' : 'no'}`);
    if (isDemandaCivil) {
      inconvenientes.push(
        `«${path.basename(p)}» es demanda CIVIL (DemandaEnLinea), no tutela. La app MVP solo radica tutela_primera/segunda/consulta_desacato.`,
      );
    }
    if (isNotifImpugnacion) {
      inconvenientes.push(
        `«${path.basename(p)}» es auto de CONCESIÓN DE IMPUGNACIÓN (2ª instancia / superior). No encaja en el carril de radicación + auto admisorio de 1ª instancia.`,
      );
      if (a.si.isSegundaInstancia) {
        console.log(`   Detección 2ª instancia: sí | CUI origen: ${a.si.originRadicado ?? '—'}`);
      }
    }
    if (isTutelaGen) console.log('   ✓ Correo válido para radicación tutela 1ª instancia');
    console.log('');
  }

  const tutelaEml = analyses.find((a) => /generaci[oó]n de tutela/i.test(String(a.parsed.subject)));
  if (!tutelaEml) {
    console.error('No hay correo de Generación de Tutela para radicar.');
    process.exit(1);
  }

  const secretarioId = await authUserId(admin, BOT_EMAILS.secretario);
  const sustanciadorId = await authUserId(admin, BOT_EMAILS.sustanciador);
  const juezId = await authUserId(admin, BOT_EMAILS.juez);
  const escribienteId = await authUserId(admin, BOT_EMAILS.escribiente);

  console.log('--- Recorrido con bots ---\n');

  let caseId: string;
  let radicado: string;
  try {
    ({ caseId, radicado } = await radicarDesdeTutelaEml(admin, tutelaEml, secretarioId, steps));
  } catch (e) {
    logStep(steps, 'Bot Secretario', 'Radicación', false, String(e));
    process.exit(1);
  }

  if ((tutelaEml.parsed.attachments?.length ?? 0) === 0) {
    inconvenientes.push(
      'El parse judicial en CLI no reexpone el buffer base64 de adjuntos en la respuesta JSON; en la UI el servidor sí los guarda en sesión. El script sube adjuntos solo si vienen en parsed.attachments con content.',
    );
  }

  let reviewId: string;
  try {
    reviewId = await sustanciadorEnviaAuto(
      admin,
      { caseId, courtId: COURT_ID, radicado, sustanciadorId },
      steps,
    );
  } catch (e) {
    logStep(steps, 'Bot Sustanciador', 'Auto admisorio', false, String(e));
    process.exit(1);
  }

  try {
    await juezApruebaAuto(admin, { caseId, courtId: COURT_ID, radicado, reviewId, juezId }, steps);
  } catch (e) {
    logStep(steps, 'Bot Juez', 'Aprobación', false, String(e));
    process.exit(1);
  }

  try {
    await escribienteNotificaAuto(admin, { caseId, courtId: COURT_ID, radicado, escribienteId }, steps);
  } catch (e) {
    logStep(steps, 'Bot Escribiente', 'Notificación auto', false, String(e));
    process.exit(1);
  }

  // --- Tramo fallo ---
  try {
    await forzarTerminoRespuestaVencido(admin, { caseId, courtId: COURT_ID, radicado, sustanciadorId }, steps);
  } catch (e) {
    logStep(steps, 'Bot Sustanciador', 'Vencimiento contestación', false, String(e));
    process.exit(1);
  }

  let reviewFalloId: string;
  try {
    reviewFalloId = await sustanciadorEnviaFallo(admin, { caseId, courtId: COURT_ID, radicado, sustanciadorId }, steps);
  } catch (e) {
    logStep(steps, 'Bot Sustanciador', 'Borrador fallo', false, String(e));
    process.exit(1);
  }

  try {
    await juezApruebaFallo(admin, { caseId, courtId: COURT_ID, radicado, reviewId: reviewFalloId, juezId }, steps);
  } catch (e) {
    logStep(steps, 'Bot Juez', 'Aprobación fallo', false, String(e));
    process.exit(1);
  }

  try {
    await escribienteNotificaFallo(admin, { caseId, courtId: COURT_ID, radicado, escribienteId }, steps);
  } catch (e) {
    logStep(steps, 'Bot Escribiente', 'Notificación fallo', false, String(e));
    process.exit(1);
  }

  const finalStage = await fetchOpenStage(admin, caseId);
  const { count: notifCount } = await admin
    .from('user_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', caseId);

  console.log('\n--- Resultado ---\n');
  console.log(`Expediente: ${caseId}`);
  console.log(`Radicado:   ${radicado}`);
  console.log(`Etapa final: ${finalStage?.stage_code ?? '—'} (${STAGE_LABEL_ES[finalStage?.stage_code as CaseStageCode] ?? ''})`);
  console.log(`Notificaciones in-app generadas: ${notifCount ?? 0}`);
  console.log(`Ver en app: /case/${caseId}`);

  if (inconvenientes.length) {
    console.log('\n--- Inconvenientes / limitaciones detectadas ---\n');
    inconvenientes.forEach((x, i) => console.log(`${i + 1}. ${x}`));
  }

  const failed = steps.filter((s) => !s.ok);
  if (failed.length) {
    console.log('\nPasos fallidos:', failed.length);
    process.exit(1);
  }
  console.log('\nRecorrido completado hasta término de impugnación (post-notificación del fallo).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
