/**
 * E2E judicial sobre Supabase: plazos D.2591 y transiciones reales de `case-stages-service`.
 * No requiere .eml ni servidor HTTP. Limpia los expedientes de prueba al finalizar.
 *
 * Uso: npm run test:e2e:judicial
 * Requiere: .env con Supabase + bots (`npm run seed:role-bots`).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  businessDayTermEndAfterEvent,
  CONTESTACION_BUSINESS_DAYS,
  IMPUGNACION_BUSINESS_DAYS,
  startOfLocalDay,
} from '../src/lib/business-days.ts';
import { computePlazoFallarDeadlineAt } from '../src/lib/plazo-fallar-tutela.ts';
import { buildRadicadoPrimeraInstancia } from '../src/lib/radicado-cui.ts';
import type { CaseStageCode } from '../src/lib/case-workflow-stages.ts';
import type { Document } from '../src/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const COURT_ID = 'court-1';
const BOT_PASSWORD = '123456';
const CLERK_EMAIL = 'bot.secretario@tutelia-despacho.seed';

type TestResult = { name: string; ok: boolean; detail?: string };

function loadEnv(): void {
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

function responsibleRoleForStage(stage: CaseStageCode): 'secretaria' | 'despacho' {
  const despacho = new Set<CaseStageCode>(['ADMISION', 'INGRESO_DESPACHO_FALLO', 'FALLO', 'EJECUTORIA']);
  return despacho.has(stage) ? 'despacho' : 'secretaria';
}

async function insertOpenStage(
  admin: SupabaseClient,
  opts: {
    courtId: string;
    caseId: string;
    stage: CaseStageCode;
    enteredAt: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from('case_stages').insert({
    court_id: opts.courtId,
    case_id: opts.caseId,
    stage_code: opts.stage,
    responsible_role: responsibleRoleForStage(opts.stage),
    entered_at: opts.enteredAt,
    exited_at: null,
    metadata: {
      ...(opts.metadata ?? {}),
      case_stage_code: opts.stage,
      responsible_role: responsibleRoleForStage(opts.stage),
    },
    created_by: opts.createdBy,
  });
  if (error) throw error;
}

async function fetchOpenStage(admin: SupabaseClient, caseId: string) {
  const { data, error } = await admin
    .from('case_stages')
    .select('id, stage_code, metadata')
    .eq('case_id', caseId)
    .is('exited_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; stage_code: string; metadata: Record<string, unknown> | null } | null;
}

async function nextTestRadicado(admin: SupabaseClient): Promise<string> {
  const tag = Date.now().toString().slice(-5);
  const cons = parseInt(tag, 10) % 90000 + 10000;
  return buildRadicadoPrimeraInstancia(String(cons), {
    cityCode: '11001',
    entityCode: '31',
    specialtyCode: '05',
    despachoCode: '051',
  });
}

function fakeDoc(caseId: string, name: string, actCode: string): Document {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    caseId,
    type: 'attachment',
    name,
    actCode,
    createdAt: now,
  };
}

async function cleanupCase(admin: SupabaseClient, caseId: string): Promise<void> {
  await admin.from('case_actions').delete().eq('case_id', caseId);
  await admin.from('case_stages').delete().eq('case_id', caseId);
  await admin.from('case_documents').delete().eq('case_id', caseId);
  await admin.from('workflow_tasks').delete().eq('case_id', caseId);
  await admin.from('user_notifications').delete().eq('case_id', caseId);
  await admin.from('cases').delete().eq('id', caseId);
}

async function testNotificacionAutoPlazoContestacion(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  clerkId: string,
): Promise<void> {
  const caseId = randomUUID();
  const radicado = await nextTestRadicado(admin);
  const now = new Date().toISOString();
  const notifiedDay = startOfLocalDay(new Date(2026, 1, 2)); // lunes 2 feb 2026

  const { error: insErr } = await admin.from('cases').insert({
    id: caseId,
    court_id: COURT_ID,
    radicado,
    claimant: 'E2E Accionante',
    defendant: 'E2E Entidad',
    status: 'received',
    case_type: 'tutela_primera',
    assigned_to: 'Bot Sustanciador',
  });
  if (insErr) throw insErr;

  await insertOpenStage(admin, {
    courtId: COURT_ID,
    caseId,
    stage: 'ADMISION',
    enteredAt: now,
    createdBy: clerkId,
    metadata: { source: 'e2e_judicial' },
  });

  const expedienteDocs = [
    fakeDoc(caseId, 'AutoAdmiteTutela.pdf', 'auto_admite'),
    fakeDoc(caseId, 'NotificacionAutoAdmite.pdf', 'notificacion_admisorio'),
  ];

  const { applyStageTransitionNotificacionAutoEnviada } = await import('../src/lib/case-stages-service.ts');
  await applyStageTransitionNotificacionAutoEnviada(userClient, {
    caseId,
    courtId: COURT_ID,
    radicado,
    caseType: 'tutela_primera',
    expedienteDocs,
    notifiedAt: notifiedDay,
  });

  const open = await fetchOpenStage(admin, caseId);
  assert.equal(open?.stage_code, 'TERMINO_RESPUESTA', 'etapa abierta tras notificación auto');
  const meta = open?.metadata ?? {};
  assert.equal(meta.notified_at, notifiedDay.toISOString(), 'notified_at persistido');
  const expectedEnd = businessDayTermEndAfterEvent(notifiedDay, CONTESTACION_BUSINESS_DAYS);
  assert.equal(meta.stage_deadline_at, expectedEnd.toISOString(), 'plazo contestación: días hábiles siguientes');
  assert.equal(meta.stage_deadline_kind, 'contestacion_accionados');

  await cleanupCase(admin, caseId);
}

async function testTutelaSegundaPlazoAlIngreso(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  clerkId: string,
): Promise<void> {
  const caseId = randomUUID();
  const radicado = `E2E2${Date.now().toString().slice(-19)}`.padEnd(23, '0').slice(0, 23);
  const now = new Date().toISOString();
  const recepcion = startOfLocalDay(new Date());

  const { error: insErr } = await admin.from('cases').insert({
    id: caseId,
    court_id: COURT_ID,
    radicado,
    claimant: 'E2E 2ª Accionante',
    defendant: 'E2E Entidad',
    status: 'received',
    case_type: 'tutela_segunda',
    deadline_at: null,
    assigned_to: 'Bot Sustanciador',
  });
  if (insErr) throw insErr;

  const { data: before } = await admin.from('cases').select('deadline_at').eq('id', caseId).single();
  assert.equal(before?.deadline_at, null, 'tutela 2ª sin plazo global al radicar');

  await insertOpenStage(admin, {
    courtId: COURT_ID,
    caseId,
    stage: 'RADICACION',
    enteredAt: now,
    createdBy: clerkId,
    metadata: { source: 'e2e_judicial' },
  });

  const expedienteDocs = [fakeDoc(caseId, 'InformeIngresoDespacho.pdf', 'informe_ingreso')];

  const { applyStageTransitionExpedienteRecibidoAlDespacho } = await import('../src/lib/case-stages-service.ts');
  await applyStageTransitionExpedienteRecibidoAlDespacho(userClient, {
    caseId,
    courtId: COURT_ID,
    radicado,
    caseType: 'tutela_segunda',
    expedienteDocs,
  });

  const open = await fetchOpenStage(admin, caseId);
  assert.equal(open?.stage_code, 'INGRESO_DESPACHO_FALLO', 'ingreso despacho tras informe');

  const { data: after } = await admin.from('cases').select('deadline_at').eq('id', caseId).single();
  const expected = computePlazoFallarDeadlineAt('tutela_segunda', recepcion);
  assert.ok(after?.deadline_at, 'deadline_at asignado al ingreso');
  assert.equal(
    startOfLocalDay(new Date(after!.deadline_at!)).getTime(),
    startOfLocalDay(new Date(expected!)).getTime(),
    'plazo global 2ª: 20 días hábiles siguientes a recepción',
  );

  await cleanupCase(admin, caseId);
}

async function testNotificacionFalloPlazoImpugnacion(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  clerkId: string,
): Promise<void> {
  const caseId = randomUUID();
  const radicado = await nextTestRadicado(admin);
  const now = new Date().toISOString();
  const notifiedDay = startOfLocalDay(new Date(2026, 1, 2));

  await admin.from('cases').insert({
    id: caseId,
    court_id: COURT_ID,
    radicado,
    claimant: 'E2E Impugnación',
    defendant: 'E2E Entidad',
    status: 'received',
    case_type: 'tutela_primera',
    assigned_to: 'Bot Sustanciador',
  });

  await insertOpenStage(admin, {
    courtId: COURT_ID,
    caseId,
    stage: 'FALLO',
    enteredAt: now,
    createdBy: clerkId,
    metadata: { source: 'e2e_judicial' },
  });

  const expedienteDocs = [
    fakeDoc(caseId, 'FalloTutela.pdf', 'fallo_tutela'),
    fakeDoc(caseId, 'NotificacionFallo.pdf', 'notificacion_fallo'),
  ];

  const { applyStageTransitionNotificacionFalloEnviada } = await import('../src/lib/case-stages-service.ts');
  await applyStageTransitionNotificacionFalloEnviada(userClient, {
    caseId,
    courtId: COURT_ID,
    radicado,
    caseType: 'tutela_primera',
    expedienteDocs,
    notifiedAt: notifiedDay,
  });

  const open = await fetchOpenStage(admin, caseId);
  assert.equal(open?.stage_code, 'TERMINO_IMPUGNACION');
  const meta = open?.metadata ?? {};
  const expectedEnd = businessDayTermEndAfterEvent(notifiedDay, IMPUGNACION_BUSINESS_DAYS);
  assert.equal(meta.stage_deadline_at, expectedEnd.toISOString(), 'plazo impugnación: días hábiles siguientes');
  assert.equal(meta.stage_deadline_kind, 'impugnacion');

  await cleanupCase(admin, caseId);
}

async function main(): Promise<void> {
  loadEnv();

  const url = normalizeUrl(
    process.env.VITE_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      '',
  );
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !anonKey || !serviceKey) {
    console.error('Faltan VITE_SUPABASE_URL, anon key o SUPABASE_SERVICE_ROLE_KEY en .env');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('id')
    .eq('email', CLERK_EMAIL)
    .maybeSingle();
  if (profErr || !profile?.id) {
    console.error('Bot secretario no encontrado. Ejecute: npm run seed:role-bots');
    process.exit(1);
  }
  const clerkId = profile.id as string;

  const { error: signErr } = await userClient.auth.signInWithPassword({
    email: CLERK_EMAIL,
    password: BOT_PASSWORD,
  });
  if (signErr) {
    console.error(`Login bot falló: ${signErr.message}`);
    process.exit(1);
  }

  const { supabase } = await import('../src/lib/supabase.ts');
  const { error: globalSignErr } = await supabase.auth.signInWithPassword({
    email: CLERK_EMAIL,
    password: BOT_PASSWORD,
  });
  if (globalSignErr) {
    console.error(`Login global supabase falló: ${globalSignErr.message}`);
    process.exit(1);
  }

  console.log('='.repeat(72));
  console.log('E2E JUDICIAL — plazos y transiciones (case-stages-service)');
  console.log('='.repeat(72));

  const tests: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'Notificación auto → plazo contestación (días siguientes)', fn: () => testNotificacionAutoPlazoContestacion(admin, userClient, clerkId) },
    { name: 'Tutela 2ª → plazo global al ingreso despacho', fn: () => testTutelaSegundaPlazoAlIngreso(admin, userClient, clerkId) },
    { name: 'Notificación fallo → plazo impugnación (días siguientes)', fn: () => testNotificacionFalloPlazoImpugnacion(admin, userClient, clerkId) },
  ];

  const results: TestResult[] = [];
  for (const t of tests) {
    process.stdout.write(`\n▶ ${t.name} … `);
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
      console.log('✓');
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      results.push({ name: t.name, ok: false, detail });
      console.log(`✗\n   ${detail}`);
    }
  }

  console.log('\n--- Resumen ---\n');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  if (failed.length) {
    console.error(`\n${failed.length} prueba(s) fallida(s).`);
    process.exit(1);
  }
  console.log(`\n${results.length} prueba(s) OK.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
