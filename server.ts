import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import axios from 'axios';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  extraerTextoPlanoDocx,
  aplicarMapeoEnDocx,
  analizarVariablesDocxConIa,
} from './docx-plantilla-server';
import { catalogoTextoParaPromptIA } from './src/lib/plantilla-marcadores-catalog.ts';
import type { DocumentTemplateTipo } from './src/types.ts';
import { PRECEDENT_SEARCH_CONFIG } from './src/config/precedentSearch.ts';
import { detectActaRepartoInPdfBuffer } from './pdf-acta-detect';
import { createPrecedentsFileRouter } from './precedents-routes';
import { SgdeClient, getDefaultSgdeBaseUrl } from './server/sgde-client';
import {
  appendParseSessionAttachments,
  createParseSession,
  getParseSession,
  markParseSessionLinkError,
  parseSessionOwnedBy,
  sweepParseSessions,
  touchParseSession,
} from './server/parse-email-sessions';
import {
  fetchJudicialArchiveFromUrl,
  parseJudicialEmailFromBuffer,
  unwrapJudicialArchiveUrl,
} from './server/parse-judicial-email';
import { assertSafeJudicialArchiveUrl, UnsafeJudicialArchiveUrlError } from './server/safe-judicial-archive-url';
import {
  digestPdfAttachmentsForSegundaInstancia,
  shouldDigestPdfsForSegundaInstancia,
  parseSegundaInstanciaFromEmail,
} from './server/sgde-segunda-instancia-parse';
import { registerOutlookRoutes } from './server/outlook-routes';
import { registerSgdeRoutes } from './server/sgde-routes';
import { registerPlatformRoutes } from './server/platform-routes';
import { createLoggedInSgdeClientForUser, sgdePlatformState } from './server/sgde-integration';
import { isSgdeTlsInsecure } from './server/sgde-tls';
import { requireCaseAccess, requireCourtAccess, userHasCourtAccess } from './server/court-access';
import { requireAuthenticatedCaller } from './server/outlook-auth';
import {
  aggregateChunkMatches,
  buildChunksForPrecedent,
  buildSyntheticSearchCard,
  createEmbedding1536,
  embedTextsBatch,
  insertPrecedentChunkRows,
  reindexPrecedent,
  vectorToPgString,
  type MatchPrecedentChunkRow,
} from './server/precedent-chunks-service.js';
import {
  extractRadicado23FromText,
  normalizeRadicado,
  PRECEDENT_RADICADO_PENDIENTE,
} from './server/precedent-radicado.js';
import {
  classifyPrecedentSource,
  fetchCourtMetaForPrecedent,
  type PrecedentSourceType,
} from './server/precedent-source-classify.js';
import { createOpenAiTlsInsecureFetch } from './server/openai-insecure-fetch.js';
import { analyzeCaseDocumentPiece } from './server/analyze-piece-service.js';
import { generateCaseSynthesis } from './server/synthesize-case-service.js';
import { runLegalAnalysisWithOpenAi } from './server/legal-analysis-service.js';
import { reviewJudicialText } from './server/ai-review-text-service.js';
import {
  inferLegalSpecialtyFromRadicado,
  normalizeLegalSpecialty,
  type LegalSpecialtyCode,
} from './src/lib/precedent-legal-specialties.ts';
import {
  inferIssuerCategoryFromCorporation,
  normalizeIssuerCategory,
  type IssuerCategoryCode,
} from './src/lib/precedent-issuer-category.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** Directorio donde está `server.ts` (raíz del código) */
const projectRoot = path.resolve(__dirname);

function stripUtf8Bom(content: string) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/** Activa cliente OpenAI con TLS relajado (proxy/antivirus). Acepta 1, true, yes, on (insensible a mayúsculas). */
function isOpenAiTlsInsecureEnv(): boolean {
  const v = String(process.env.OPENAI_TLS_INSECURE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Lee `.env` y `.env.local` en varios directorios (código + cwd) y fusiona:
 * - orden: `projectRoot` (.env → .env.local), luego `process.cwd()` igual;
 * - un valor no vacío en un archivo posterior sustituye al anterior;
 * - una línea vacía no borra un valor ya fusionado.
 * Así funciona aunque `npm run dev` se ejecute desde otra carpeta o haya BOM en `.env`.
 */
function loadProjectEnv() {
  const dirs = [projectRoot];
  const cwd = path.resolve(process.cwd());
  if (cwd !== projectRoot) dirs.push(cwd);

  const merged: Record<string, string> = {};
  const loadedFrom: string[] = [];

  for (const dir of dirs) {
    for (const name of ['.env', '.env.local'] as const) {
      const full = path.join(dir, name);
      if (!fs.existsSync(full)) continue;
      loadedFrom.push(full);
      const raw = stripUtf8Bom(fs.readFileSync(full, 'utf8'));
      const parsed = dotenv.parse(raw);
      for (const [key, rawVal] of Object.entries(parsed)) {
        const t = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal).trim();
        if (t !== '') merged[key] = t;
        else if (!(key in merged)) merged[key] = '';
      }
    }
  }

  /** Valores del merge sustituyen process.env para que .env/.env.local manden en local (evita variables viejas del shell). */
  for (const [key, val] of Object.entries(merged)) {
    if (val !== '') {
      process.env[key] = val;
    }
  }

  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  console.log(
    `[tutelia] OPENAI_API_KEY: ${hasOpenAi ? 'OK' : 'NO'}. GEMINI_API_KEY: ${hasGemini ? 'OK' : 'NO'}. ` +
      `OPENAI_TLS_INSECURE (HTTPS relajado hacia OpenAI): ${isOpenAiTlsInsecureEnv() ? 'SÍ' : 'no'}. ` +
      `SGDE_TLS relajado: ${isSgdeTlsInsecure() ? 'SÍ' : 'no'}. ` +
      `Raíz server: ${projectRoot}. cwd: ${cwd}. ` +
      `Archivos leídos: ${loadedFrom.length ? loadedFrom.join(' | ') : '(ninguno)'}`
  );
}

/**
 * Proxy/antivirus corporativo: Node falla TLS hacia api.openai.com (UNABLE_TO_VERIFY_LEAF_SIGNATURE).
 * Solo diagnóstico local; en producción preferir NODE_EXTRA_CA_CERTS con el PEM de la CA.
 * Afecta a todo el proceso (también Supabase u otras salidas HTTPS desde server.ts).
 */
function applyOpenAiTlsDevBypass() {
  if (!isOpenAiTlsInsecureEnv()) return;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn(
    '[tutelia] OPENAI_TLS_INSECURE activo: verificación TLS global en Node desactivada (NODE_TLS_REJECT_UNAUTHORIZED=0). ' +
      'Solo para diagnóstico local; use NODE_EXTRA_CA_CERTS si puede.'
  );
}

loadProjectEnv();
applyOpenAiTlsDevBypass();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Si `npm run dev` arrancó antes de que existiera `.env`, el primer `loadProjectEnv` no leyó nada.
 * Vite reinicia su servidor pero no este proceso. Recargamos al cambiar mtime de `.env` / `.env.local`.
 * No usamos `fs.watch` en el directorio: con Vite suele dispararse EMFILE (demasiados descriptores).
 */
function setupProjectEnvWatch() {
  const cwd = path.resolve(process.cwd());
  const dirs = cwd === projectRoot ? [projectRoot] : [projectRoot, cwd];
  const paths: string[] = [];
  for (const dir of dirs) {
    paths.push(path.join(dir, '.env'), path.join(dir, '.env.local'));
  }

  const mtimeMs = (p: string): number => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return -1;
    }
  };
  const last = new Map<string, number>();
  for (const p of paths) last.set(p, mtimeMs(p));

  const tick = () => {
    let changed = false;
    for (const p of paths) {
      const cur = mtimeMs(p);
      if (cur !== last.get(p)) {
        last.set(p, cur);
        changed = true;
      }
    }
    if (!changed) return;
    console.log('[tutelia] Cambio en .env / .env.local; recargando variables…');
    loadProjectEnv();
    applyOpenAiTlsDevBypass();
    openAiClientSingleton = null;
    openAiClientTlsInsecureSingleton = null;
    for (const p of paths) last.set(p, mtimeMs(p));
  };

  const iv = setInterval(tick, 1500);
  iv.unref?.();
}

setupProjectEnvWatch();

const PORT = Number(process.env.PORT || '3451');
const BODY_LIMIT = '100mb';

let openAiClientSingleton: OpenAI | null = null;
let openAiClientTlsInsecureSingleton: OpenAI | null = null;

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Falta OPENAI_API_KEY. Cree .env o .env.local en la raíz del proyecto (junto a server.ts) o en la carpeta desde que ejecuta npm run dev. Reinicie el servidor tras guardar. Revise la consola del terminal al arrancar: línea [tutelia] OPENAI_API_KEY.'
    );
  }
  const insecure = isOpenAiTlsInsecureEnv();
  if (insecure) {
    if (!openAiClientTlsInsecureSingleton) {
      console.warn(
        '[tutelia] OpenAI: OPENAI_TLS_INSECURE activo — peticiones HTTPS vía node:https sin verificar certificado (solo diagnóstico).'
      );
      openAiClientTlsInsecureSingleton = new OpenAI({
        apiKey,
        fetch: createOpenAiTlsInsecureFetch(),
      });
    }
    return openAiClientTlsInsecureSingleton;
  }
  if (!openAiClientSingleton) {
    openAiClientSingleton = new OpenAI({ apiKey });
  }
  return openAiClientSingleton;
}

function normalizeSupabaseProjectUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s || undefined;
}

let supabaseAdminSingleton: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  const url = normalizeSupabaseProjectUrl(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      'Faltan SUPABASE_URL (o VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY para precedentes e índice vectorial.'
    );
  }
  supabaseAdminSingleton = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return supabaseAdminSingleton;
}

type SgdeCaseRow = {
  id: string;
  court_id: string;
  radicado: string | null;
  sgde_id: string | null;
};

/** @deprecated Usar requireCaseAccess desde court-access.ts */
async function requireCaseAccessForCaller(
  req: express.Request,
  caseId: string
): Promise<
  | { ok: true; admin: SupabaseClient; caseRow: SgdeCaseRow }
  | { ok: false; status: number; message: string }
> {
  const acc = await requireCaseAccess(req, getSupabaseAdmin, caseId);
  if (acc.ok === false) return acc;
  return { ok: true, admin: acc.admin, caseRow: acc.caseRow };
}

/** @deprecated Usar requireCourtAccess desde court-access.ts */
async function requireCallerCourtAccess(
  req: express.Request,
  courtIdParam: string
): Promise<
  | { ok: true; admin: SupabaseClient; courtId: string }
  | { ok: false; status: number; message: string }
> {
  const acc = await requireCourtAccess(req, getSupabaseAdmin, courtIdParam);
  if (acc.ok === false) return acc;
  return { ok: true, admin: acc.admin, courtId: acc.courtId };
}

const CASE_DOCUMENTS_BUCKET = 'case-documents';
const PRECEDENT_PDF_SIGNED_URL_TTL_SEC = 3600;

function buildPrecedentPdfStoragePath(courtId: string, precedentId: string): string {
  return `precedents/${courtId}/${precedentId}.pdf`;
}

/** Sube PDF de precedente; si falla solo registra en log (no aborta indexación). */
async function persistPrecedentPdfAfterIndex(
  supabase: SupabaseClient,
  courtId: string,
  precedentId: string,
  pdfBuffer: Buffer
): Promise<boolean> {
  const path = buildPrecedentPdfStoragePath(courtId, precedentId);
  const { error: uploadErr } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (uploadErr) {
    console.error('[precedents] storage upload:', uploadErr.message);
    return false;
  }
  const { error: updErr } = await supabase
    .from('precedents')
    .update({ source_storage_path: path })
    .eq('id', precedentId);
  if (updErr) {
    console.error('[precedents] source_storage_path update:', updErr.message);
    return false;
  }
  return true;
}

async function enrichPrecedentSearchResultsWithStoragePath(
  supabase: SupabaseClient,
  results: Array<Record<string, unknown>>
): Promise<void> {
  const ids = results.map((r) => String(r.id || '')).filter(Boolean);
  if (!ids.length) return;
  const { data, error } = await supabase.from('precedents').select('id, source_storage_path').in('id', ids);
  if (error) {
    console.warn('[precedents/search] source_storage_path lookup:', error.message);
    return;
  }
  const byId = new Map((data ?? []).map((row) => [String(row.id), row.source_storage_path as string | null]));
  for (const row of results) {
    const id = String(row.id || '');
    row.source_storage_path = byId.get(id) ?? null;
  }
}

const PRECEDENT_ROW_SELECT =
  'id, court_id, source_case_id, source_type, source_corporation, legal_specialty, issuer_category, radicado, right_protected, defendant, ruling_sense, legal_arguments, summary, decision_date, tags, source_storage_path, index_status, created_at, updated_at';

const LEGAL_SPECIALTY_JSON_ENUM = [
  'tutela',
  'civil',
  'laboral',
  'familia',
  'penal',
  'administrativo',
  'agrario',
  'constitucional',
  'contencioso',
  'comercial',
  'mixto',
  'otro',
] as const;

const ISSUER_CATEGORY_JSON_ENUM = [
  'corte_constitucional',
  'corte_suprema',
  'consejo_estado',
  'tribunal',
  'juzgado',
  'juzgado_pequenas_causas',
  'comision',
  'otro',
] as const;

function resolveLegalSpecialtyForPrecedent(
  fromIa: string | undefined,
  radicado: string,
  userHint?: string | undefined
): LegalSpecialtyCode {
  const hint = normalizeLegalSpecialty(userHint);
  if (hint) return hint;
  const ia = normalizeLegalSpecialty(fromIa);
  if (ia) return ia;
  const fromRad = inferLegalSpecialtyFromRadicado(radicado);
  if (fromRad) return fromRad;
  return 'otro';
}

function resolveIssuerCategoryForPrecedent(
  fromIa: string | undefined,
  sourceCorporation: string,
  userHint?: string | undefined
): IssuerCategoryCode {
  const hint = normalizeIssuerCategory(userHint);
  if (hint) return hint;
  const ia = normalizeIssuerCategory(fromIa);
  if (ia) return ia;
  const fromCorp = inferIssuerCategoryFromCorporation(sourceCorporation);
  if (fromCorp) return fromCorp;
  return 'otro';
}

async function requirePrecedentCourtAccessForCaller(
  req: express.Request,
  precedentId: string
): Promise<
  | { ok: true; admin: SupabaseClient; courtId: string; precedent: Record<string, unknown> }
  | { ok: false; status: number; message: string }
> {
  const auth = await requireAuthenticatedCaller(req, getSupabaseAdmin);
  if (auth.ok === false) {
    return { ok: false, status: auth.status, message: auth.message };
  }
  const { data: prec, error: precErr } = await auth.admin
    .from('precedents')
    .select(PRECEDENT_ROW_SELECT)
    .eq('id', precedentId)
    .maybeSingle();
  if (precErr || !prec?.id) {
    return { ok: false, status: 404, message: 'Precedente no encontrado.' };
  }
  const courtId = String(prec.court_id);
  const allowed = await userHasCourtAccess(auth.admin, auth.userId, courtId);
  if (!allowed) {
    return { ok: false, status: 403, message: 'No autorizado para este precedente.' };
  }
  return { ok: true, admin: auth.admin, courtId, precedent: prec as Record<string, unknown> };
}

async function requirePrecedentAccessForCaller(
  req: express.Request,
  precedentId: string
): Promise<
  | { ok: true; admin: SupabaseClient; courtId: string; sourceStoragePath: string }
  | { ok: false; status: number; message: string }
> {
  const acc = await requirePrecedentCourtAccessForCaller(req, precedentId);
  if (acc.ok === false) return acc;
  const sourceStoragePath = String(acc.precedent.source_storage_path || '').trim();
  if (!sourceStoragePath) {
    return { ok: false, status: 404, message: 'Este precedente no tiene PDF almacenado.' };
  }
  return { ok: true, admin: acc.admin, courtId: acc.courtId, sourceStoragePath };
}

async function insertPrecedentRow(opts: {
  openai: OpenAI;
  supabase: SupabaseClient;
  courtId: string;
  caseId: string | null;
  sourceType: PrecedentSourceType;
  sourceCorporation: string | null;
  radicado: string;
  rightProtected: string;
  defendant: string;
  rulingSense: string;
  legalArguments: string;
  summary: string;
  decisionDate: string | null;
  tags: string[];
  legalSpecialty: LegalSpecialtyCode;
  issuerCategory: IssuerCategoryCode;
  logIndexFromFileDebug?: boolean;
}) {
  const {
    openai,
    supabase,
    courtId,
    caseId,
    sourceType,
    sourceCorporation,
    radicado,
    rightProtected,
    defendant,
    rulingSense,
    legalArguments,
    summary,
    decisionDate,
    tags,
    legalSpecialty,
    issuerCategory,
    logIndexFromFileDebug,
  } = opts;
  const radicadoNorm = normalizeRadicado(radicado);
  if (caseId) {
    const { error: delErr } = await supabase
      .from('precedents')
      .delete()
      .eq('court_id', courtId)
      .eq('source_case_id', caseId);
    if (delErr) throw delErr;
  }

  const chunks = buildChunksForPrecedent({
    radicado: radicadoNorm,
    rightProtected,
    rulingSense,
    defendant,
    legalArguments,
    summary,
    sourceType,
    sourceCorporation,
  });
  const chunkTexts = chunks.map((c) => c.text);
  const vectors = await embedTextsBatch(openai, chunkTexts);
  const searchCardText = buildSyntheticSearchCard({
    right_protected: rightProtected,
    ruling_sense: rulingSense,
    summary,
  });
  const parentVector = await createEmbedding1536(openai, searchCardText);
  const embParent = vectorToPgString(parentVector);

  if (logIndexFromFileDebug) {
    console.log(
      '[precedents/index-from-file] fragmentos:',
      chunks.length,
      '; vector padre (= ficha sintética), dimensión=',
      parentVector.length
    );
    console.log(
      '[precedents/index-from-file] ficha sintética (chars):',
      searchCardText.length,
      '; pgvector padre (chars):',
      embParent.length
    );
  }

  const { data, error } = await supabase
    .from('precedents')
    .insert({
      court_id: courtId,
      source_case_id: caseId || null,
      source_type: sourceType,
      source_corporation: sourceCorporation,
      legal_specialty: legalSpecialty,
      issuer_category: issuerCategory,
      radicado: radicadoNorm,
      right_protected: rightProtected,
      defendant,
      ruling_sense: rulingSense,
      legal_arguments: legalArguments,
      summary,
      decision_date: decisionDate,
      tags,
      embedding: embParent,
      index_status: 'pending',
    })
    .select(PRECEDENT_ROW_SELECT)
    .single();
  if (error) throw error;

  const precedentId = String(data.id);
  try {
    await insertPrecedentChunkRows(supabase, precedentId, courtId, chunks, vectors);
    const { error: readyErr } = await supabase
      .from('precedents')
      .update({ index_status: 'ready' })
      .eq('id', precedentId);
    if (readyErr) throw readyErr;
  } catch (chunkErr: any) {
    await supabase.from('precedents').update({ index_status: 'failed' }).eq('id', precedentId);
    const msg = String(chunkErr?.message || chunkErr || '');
    throw new Error(
      msg.includes('precedent_chunks') || msg.includes('match_precedent_chunks') || msg.includes('does not exist')
        ? 'Índice de fragmentos no disponible. Aplique la migración 20260515140000_precedent_chunks en Supabase y reintente.'
        : msg || 'Error al guardar fragmentos vectoriales del precedente.'
    );
  }

  return { ...data, index_status: 'ready' };
}

function parseDecisionDateYmd(raw: string): string | null {
  const t = String(raw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : t;
}

const PRECEDENT_EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    radicado: { type: 'string' },
    source_corporation: { type: 'string' },
    right_protected: { type: 'string' },
    ruling_sense: { type: 'string' },
    summary: { type: 'string' },
    legal_arguments: { type: 'string' },
    decision_date: { type: 'string' },
    defendant: { type: 'string' },
    legal_specialty: { type: 'string', enum: [...LEGAL_SPECIALTY_JSON_ENUM] },
    issuer_category: { type: 'string', enum: [...ISSUER_CATEGORY_JSON_ENUM] },
  },
  required: [
    'radicado',
    'source_corporation',
    'right_protected',
    'ruling_sense',
    'summary',
    'legal_arguments',
    'decision_date',
    'defendant',
    'legal_specialty',
    'issuer_category',
  ],
} as const;

type PrecedentExtract = {
  radicado: string;
  source_corporation: string;
  right_protected: string;
  ruling_sense: string;
  summary: string;
  legal_arguments: string;
  decision_date: string;
  defendant: string;
  legal_specialty: string;
  issuer_category: string;
};

const PRECEDENT_SHORT_EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    radicado: { type: 'string' },
    source_corporation: { type: 'string' },
    right_protected: { type: 'string' },
    ruling_sense: { type: 'string' },
    summary: { type: 'string' },
    decision_date: { type: 'string' },
    defendant: { type: 'string' },
    legal_specialty: { type: 'string', enum: [...LEGAL_SPECIALTY_JSON_ENUM] },
    issuer_category: { type: 'string', enum: [...ISSUER_CATEGORY_JSON_ENUM] },
  },
  required: [
    'radicado',
    'source_corporation',
    'right_protected',
    'ruling_sense',
    'summary',
    'decision_date',
    'defendant',
    'legal_specialty',
    'issuer_category',
  ],
} as const;

type PrecedentShortExtract = {
  radicado: string;
  source_corporation: string;
  right_protected: string;
  ruling_sense: string;
  summary: string;
  decision_date: string;
  defendant: string;
  legal_specialty: string;
  issuer_category: string;
};

function buildPrecedentSummaryFallback(extracted: PrecedentExtract): string {
  const s = String(extracted.summary || '').trim();
  if (s.length >= 20) return s;
  const combo = [extracted.ruling_sense, extracted.right_protected].filter(Boolean).join(' — ').trim();
  if (combo.length >= 20) return combo;
  const args = String(extracted.legal_arguments || '').trim();
  if (args.length >= 80) return args.slice(0, 400).trim();
  return combo || 'Resumen pendiente de revisión manual.';
}

async function extractPrecedentWithOpenAiPdf(openai: OpenAI, pdfBase64: string): Promise<PrecedentExtract> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const promptLargo = `Eres secretario judicial en Colombia. Lee el PDF adjunto (cualquier providencia judicial: tutela, sentencia civil, laboral, contencioso, penal cuando proceda, auto, interlocutorio, ejecutivo, ordinario u otro acto con decisión o trámite relevante).
Tu salida debe ser ÚNICAMENTE prosa continua en español: sin títulos, sin viñetas, sin numeraciones, sin JSON, sin markdown.
Redacta un solo texto corrido que integre de forma natural: tipo de actuación y despacho o corporación que la profiere; hechos o antecedentes relevantes del caso; pretensiones o derechos invocados por la parte actora; posición de la parte demandada o accionada; fundamentos normativos y jurisprudenciales aplicados; criterio jurídico central o ratio decidendi; sentido de la decisión y sus efectos.
El texto debe tener al menos 2500 caracteres. Si el documento tiene consideraciones jurídicas extensas, incorpóralas con fidelidad (no omitas pasajes sustanciales). No inventes hechos ajenos al acto.`;

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) {
    throw new Error(
      'Falta GEMINI_API_KEY para extraer texto del PDF (Llamada 1). Configúrela en .env y reinicie npm run dev.'
    );
  }

  const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });
  const geminiLargo = await geminiModel.generateContent([
    promptLargo,
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBase64,
      },
    },
  ]);
  const geminiLargoResponse = geminiLargo.response;
  let textoExtraido = String(geminiLargoResponse.text() || '').trim();
  textoExtraido = textoExtraido.replace(/^```[\w]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  const textoParaContexto =
    textoExtraido.length > 100_000 ? textoExtraido.slice(0, 100_000) : textoExtraido;

  const promptCortos = `Eres secretario judicial en Colombia. A partir del siguiente texto ya extraído de un fallo (prosa continua), completa el JSON indicado con datos breves y precisos. Si algo no consta en el texto, usa cadena vacía salvo defendant donde puede usarse "—".

Texto extraído del fallo:
---
${textoParaContexto}
---

Campos del JSON (no dejes vacíos si el texto los contiene):
- radicado: número CUI de 23 dígitos o referencia (T-760/08, SU-062/18).
- source_corporation: juzgado, tribunal o corte que emitió el acto (nombre completo).
- right_protected: materia o pretensión principal del proceso en una frase (mín. 15 caracteres).
- ruling_sense: sentido del fallo (concede, niega, inadmite, revoca, etc.; mín. 8 caracteres).
- summary: resumen ejecutivo agnóstico al tipo de proceso. Debe incluir en prosa continua: tipo de actuación, materia, hechos centrales, posición de las partes, sentido de la decisión y criterio jurídico aplicado. Entre 4 y 8 oraciones.
- decision_date: AAAA-MM-DD si se deduce con claridad; si no, cadena vacía.
- defendant: demandado, accionado o entidad principal; si no aplica, "—".
- legal_specialty: una de tutela, civil, laboral, familia, penal, administrativo, agrario, constitucional, contencioso, comercial, mixto, otro — según el tipo de proceso del acto (la tutela es la misma figura en todo el país; use tutela cuando el acto sea acción de tutela).
- issuer_category: categoría de la corporación que profiere el acto: corte_constitucional, corte_suprema, consejo_estado, tribunal, juzgado, juzgado_pequenas_causas, comision, otro — deducido del nombre del despacho en source_corporation.`;

  const resCortos = await openai.responses.create({
    model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: promptCortos }] }],
    text: {
      format: {
        type: 'json_schema',
        name: 'precedent_short_extract',
        schema: PRECEDENT_SHORT_EXTRACT_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    },
  });

  const short = JSON.parse(resCortos.output_text || '{}') as PrecedentShortExtract;
  const radicado = String(short.radicado || '').trim();
  const source_corporation = String(short.source_corporation || '').trim();
  const right_protected = String(short.right_protected || '').trim();
  const ruling_sense = String(short.ruling_sense || '').trim();
  const decision_date = String(short.decision_date || '').trim();
  const defendant = String(short.defendant || '').trim();
  const summary = String(short.summary || '').trim();
  const legal_specialty = resolveLegalSpecialtyForPrecedent(
    String(short.legal_specialty || ''),
    radicado
  );
  const issuer_category = resolveIssuerCategoryForPrecedent(
    String(short.issuer_category || ''),
    source_corporation
  );

  const metaLine = [
    `Radicado: ${radicado}`,
    `Corporación: ${source_corporation}`,
    `Materia: ${right_protected}`,
    `Sentido: ${ruling_sense}`,
    `Fecha: ${decision_date}`,
    `Accionado: ${defendant}`,
  ].join(' ');

  return {
    radicado,
    source_corporation,
    right_protected,
    ruling_sense,
    summary,
    legal_arguments: `${textoExtraido}\n\n${metaLine}`,
    decision_date,
    defendant,
    legal_specialty,
    issuer_category,
  };
}

async function extractPrecedentWithOpenAiPlainText(openai: OpenAI, plainText: string): Promise<PrecedentExtract> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const slice = plainText.length > 100_000 ? plainText.slice(0, 100_000) : plainText;
  const prompt = `Eres secretario judicial en Colombia. El siguiente texto fue extraído de un documento Word (.docx) judicial.
Extrae los mismos campos que si fuera un PDF de sentencia. Responde SOLO con el JSON indicado.

Campos (obligatorio rellenar si constan en el documento):
- radicado, source_corporation, right_protected, ruling_sense, decision_date (AAAA-MM-DD o vacío), defendant (o "—").
- legal_specialty: tutela | civil | laboral | familia | penal | administrativo | agrario | constitucional | contencioso | comercial | mixto | otro.
- issuer_category: corte_constitucional | corte_suprema | consejo_estado | tribunal | juzgado | juzgado_pequenas_causas | comision | otro.
- summary: resumen ejecutivo 2–4 oraciones para tabla (mín. 40 caracteres si hay contenido suficiente).
- legal_arguments: texto corrido en español, sin títulos, sin viñetas, sin numeraciones, prosa continua optimizada para embedding semántico. Mínimo 2500 caracteres. Debe integrar obligatoriamente en el discurso: (1) hechos relevantes del caso, (2) derechos fundamentales invocados o analizados, (3) posición del accionado o partes, (4) ratio decidendi, (5) regla o criterio aplicado, (6) sentido del fallo y por qué el tribunal así decide. Sin inventar hechos ajenos al documento.

--- TEXTO DEL DOCUMENTO ---
${slice}`;

  const result = await openai.responses.create({
    model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    text: {
      format: {
        type: 'json_schema',
        name: 'precedent_extract',
        schema: PRECEDENT_EXTRACT_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    },
  });
  const content = result.output_text || '{}';
  const parsed = JSON.parse(content) as PrecedentExtract;
  parsed.legal_specialty = resolveLegalSpecialtyForPrecedent(
    parsed.legal_specialty,
    String(parsed.radicado || '')
  );
  parsed.issuer_category = resolveIssuerCategoryForPrecedent(
    parsed.issuer_category,
    String(parsed.source_corporation || '')
  );
  return parsed;
}

function mapAiError(error: any) {
  const chain: unknown[] = [];
  let cur: unknown = error;
  const seen = new Set<unknown>();
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    const c = cur as { cause?: unknown };
    cur = c?.cause ?? null;
  }
  for (const e of chain) {
    const o = e as { code?: string; message?: string };
    const code = o?.code;
    const msg = String(o?.message || '').toLowerCase();
    if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || msg.includes('unable to verify the first certificate')) {
      return {
        status: 503,
        message:
          'No se pudo verificar el certificado TLS al conectar con OpenAI (proxy o antivirus en la red). ' +
          'Para pruebas locales puede añadir OPENAI_TLS_INSECURE=1 en .env y reiniciar npm run dev; ' +
          'mejor solución: NODE_EXTRA_CA_CERTS apuntando al PEM de la CA corporativa.',
      };
    }
  }

  const status = error?.status ?? error?.statusCode ?? 500;
  const rawMessage = String(error?.message || '');
  if (status === 429 || rawMessage.includes('rate limit') || rawMessage.includes('quota')) {
    return {
      status: 429,
      message: 'Cuota o límite de OpenAI agotado temporalmente. Intente de nuevo en unos segundos.'
    };
  }
  if (status === 401 || rawMessage.toLowerCase().includes('api key')) {
    return { status: 401, message: 'API key de OpenAI inválida o no autorizada.' };
  }
  return { status, message: rawMessage || 'Error inesperado al consultar OpenAI.' };
}

const handlePrecedentsAttachPdf: express.RequestHandler = async (req, res) => {
  try {
    const precedentId = String(req.params.id || '').trim();
    if (!precedentId) {
      return res.status(400).json({ error: 'id es requerido' });
    }
    const acc = await requirePrecedentCourtAccessForCaller(req, precedentId);
    if (acc.ok === false) {
      return res.status(acc.status).json({ error: acc.message });
    }

    const multerReq = req as Express.Request & {
      file?: { buffer: Buffer; originalname?: string; mimetype?: string };
    };
    const file = multerReq.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ error: 'Adjunte un archivo PDF' });
    }
    const lower = file.originalname?.toLowerCase() ?? '';
    const isPdf = lower.endsWith('.pdf') || file.mimetype === 'application/pdf';
    if (!isPdf) {
      return res.status(400).json({ error: 'Solo se admiten archivos .pdf' });
    }

    const courtId = String(acc.precedent.court_id || '');
    const ok = await persistPrecedentPdfAfterIndex(acc.admin, courtId, precedentId, Buffer.from(file.buffer));
    if (!ok) {
      return res.status(500).json({
        error:
          'No se pudo guardar el PDF en almacenamiento. Compruebe el bucket case-documents y los logs del servidor.',
      });
    }

    const { data, error } = await acc.admin
      .from('precedents')
      .select(PRECEDENT_ROW_SELECT)
      .eq('id', precedentId)
      .single();
    if (error) throw error;
    return res.json({ precedent: data });
  } catch (error: any) {
    console.error('precedents/attach-pdf:', error);
    const msg = String(error?.message || '');
    if (msg.includes('Faltan SUPABASE') || msg.includes('SUPABASE_SERVICE_ROLE')) {
      return res.status(503).json({ error: msg });
    }
    return res.status(500).json({ error: msg || 'Error al adjuntar PDF' });
  }
};

const handlePrecedentsIndexFromFile: express.RequestHandler = async (req, res) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const legalSpecialtyHint = String(body.legalSpecialty || body.legal_specialty || '').trim();
    const issuerCategoryHint = String(body.issuerCategory || body.issuer_category || '').trim();
    const courtId = String(body.courtId || '').trim();
    const sourceTypeHintRaw = String(body.sourceType || body.sourceTypeHint || '').trim().toLowerCase();
    const sourceTypeHint: PrecedentSourceType | null =
      sourceTypeHintRaw === 'despacho' || sourceTypeHintRaw === 'jurisprudencia' ? sourceTypeHintRaw : null;
    const sourceCorporationFallback = String(body.sourceCorporation || '').trim();
    const radicadoHint = String(body.radicadoHint || '').trim();

    if (!courtId) {
      return res.status(400).json({ error: 'courtId es requerido' });
    }

    const acc = await requireCallerCourtAccess(req, courtId);
    if (acc.ok === false) {
      return res.status(acc.status).json({ error: acc.message });
    }

    const multerReq = req as Express.Request & {
      file?: { buffer: Buffer; originalname?: string; mimetype?: string };
    };
    const file = multerReq.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ error: 'Adjunte un archivo PDF o DOCX' });
    }

    const lower = file.originalname?.toLowerCase() ?? '';
    const isPdf = lower.endsWith('.pdf') || file.mimetype === 'application/pdf';
    const isDocx =
      lower.endsWith('.docx') ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isPdf && !isDocx) {
      return res.status(400).json({ error: 'Solo se admiten archivos .pdf o .docx' });
    }

    const openai = getOpenAiClient();
    let extracted: PrecedentExtract;
    try {
      if (isPdf) {
        console.log(
          '[precedents/index-from-file] PDF recibido (bytes archivo):',
          file.buffer.length,
          '(la extracción de texto la hace el modelo sobre el PDF)'
        );
        extracted = await extractPrecedentWithOpenAiPdf(openai, file.buffer.toString('base64'));
      } else {
        const texto = await extraerTextoPlanoDocx(Buffer.from(file.buffer));
        const docxLen = texto.trim().length;
        console.log('[precedents/index-from-file] texto extraído del DOCX (chars, sin vacíos extremos):', docxLen);
        if (!texto.trim()) {
          return res.status(400).json({
            error: 'No se pudo extraer texto del Word. Verifique que el .docx tenga contenido.',
          });
        }
        extracted = await extractPrecedentWithOpenAiPlainText(openai, texto);
      }
    } catch (parseErr: any) {
      console.error('precedents/index-from-file extract:', parseErr);
      const mapped = mapAiError(parseErr);
      return res.status(mapped.status).json({ error: mapped.message });
    }

    const textoPostIaLen = [
      extracted.right_protected,
      extracted.legal_arguments,
      extracted.summary,
    ]
      .join(' ')
      .trim().length;
    console.log(
      '[precedents/index-from-file] contenido extraído por IA para indexar (chars derecho+argumentos+resumen):',
      textoPostIaLen
    );
    if (textoPostIaLen === 0) {
      console.warn('[precedents/index-from-file] advertencia: derecho+argumentos+resumen vacíos tras la IA');
    }

    let rawRadicado = String(extracted.radicado || '').trim() || radicadoHint;
    if (!rawRadicado) {
      const fromText = extractRadicado23FromText(
        [extracted.legal_arguments, extracted.summary, extracted.right_protected].join('\n')
      );
      if (fromText) rawRadicado = fromText;
    }
    const warnings: string[] = [];
    let radicado: string;
    if (!rawRadicado) {
      radicado = PRECEDENT_RADICADO_PENDIENTE;
      warnings.push('PDF indexado sin radicado. Puedes editarlo desde la biblioteca.');
    } else {
      radicado = normalizeRadicado(rawRadicado);
    }

    const supabase = getSupabaseAdmin();
    const courtMeta = await fetchCourtMetaForPrecedent(supabase, courtId);
    const extractedCorp = String(extracted.source_corporation || '').trim() || sourceCorporationFallback;
    const classified = classifyPrecedentSource({
      court: courtMeta,
      sourceCorporation: extractedCorp,
      radicado,
      userHint: sourceTypeHint,
    });
    const sourceType = classified.sourceType;
    let sourceCorporation: string | null = classified.sourceCorporation;
    if (sourceType === 'jurisprudencia' && !sourceCorporation && extractedCorp) {
      sourceCorporation = extractedCorp;
    }
    if (sourceType === 'jurisprudencia' && !sourceCorporation) {
      warnings.push(
        'No se identificó corporación externa; quedó como jurisprudencia de referencia sin corporación.'
      );
    }

    let defendantOut = String(extracted.defendant || '').trim();
    if (!defendantOut) defendantOut = '—';

    const rightProtected = String(extracted.right_protected || '').trim() || 'Materia no determinada';
    const rulingSense = String(extracted.ruling_sense || '').trim() || 'Sentido no determinado';
    const summary = buildPrecedentSummaryFallback(extracted);
    if (rightProtected === 'Materia no determinada' || rulingSense === 'Sentido no determinado') {
      warnings.push(
        'La IA no completó materia o sentido del fallo. Revise la fila en la tabla y edite si hace falta.'
      );
    }
    const legalArguments =
      String(extracted.legal_arguments || '').trim() || 'Sin detalle de argumentos automático.';
    if ([rightProtected, rulingSense, summary, legalArguments].join(' ').trim().length < 30) {
      return res.status(422).json({
        error:
          'La IA no obtuvo suficiente texto del archivo. Pruebe con otro PDF (texto seleccionable) o un .docx con contenido.',
      });
    }

    const decisionDate = parseDecisionDateYmd(extracted.decision_date);
    const tags = sourceType === 'jurisprudencia' && sourceCorporation ? [sourceCorporation] : [];
    const legalSpecialty = resolveLegalSpecialtyForPrecedent(
      extracted.legal_specialty,
      radicado,
      legalSpecialtyHint
    );
    const issuerCategory = resolveIssuerCategoryForPrecedent(
      extracted.issuer_category,
      sourceCorporation,
      issuerCategoryHint
    );

    const data = await insertPrecedentRow({
      openai,
      supabase,
      courtId,
      caseId: null,
      sourceType,
      sourceCorporation,
      radicado,
      rightProtected,
      defendant: defendantOut,
      rulingSense,
      legalArguments,
      summary,
      decisionDate,
      tags,
      legalSpecialty,
      issuerCategory,
      logIndexFromFileDebug: true,
    });
    if (isPdf) {
      await persistPrecedentPdfAfterIndex(supabase, courtId, String(data.id), Buffer.from(file.buffer));
      const { data: refreshed } = await supabase
        .from('precedents')
        .select(PRECEDENT_ROW_SELECT)
        .eq('id', data.id)
        .single();
      return res.json({
        precedent: refreshed ?? data,
        extracted,
        warnings,
        classified: { sourceType, reason: classified.reason },
      });
    }
    return res.json({ precedent: data, extracted, warnings, classified: { sourceType, reason: classified.reason } });
  } catch (error: any) {
    console.error('precedents/index-from-file:', error);
    const msg = String(error?.message || '');
    if (msg.includes('Faltan SUPABASE') || msg.includes('SUPABASE_SERVICE_ROLE')) {
      return res.status(503).json({ error: msg });
    }
    const mapped = mapAiError(error);
    if (mapped.status !== 500) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    return res.status(500).json({ error: msg || 'Error al indexar desde archivo' });
  }
};

async function startServer() {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 32 * 1024 * 1024 },
  });
  /** Portal / uniones pueden superar 32 MB (anexos ~50 MB). */
  const uploadLarge = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 80 * 1024 * 1024 },
  });

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  const corsOrigins = (process.env.CORS_ORIGIN || process.env.APP_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (corsOrigins.length) {
    app.use((req, res, next) => {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : '';
      if (origin && corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, x-tutelia-mailbox-id'
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });
  }

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      outlookApiBuild: '2026-05-19-classify-light-v1',
    });
  });

  registerOutlookRoutes(app, getSupabaseAdmin);
  registerSgdeRoutes(app, getSupabaseAdmin, getOpenAiClient);
  registerPlatformRoutes(app, getSupabaseAdmin);

  app.post('/api/sgde/case-tree', async (req, res) => {
    try {
      const caseId = String((req.body as { caseId?: string })?.caseId || '').trim();
      if (!caseId) {
        return res.status(400).json({ error: 'caseId es requerido' });
      }
      const platform = sgdePlatformState();
      if (!platform.available) {
        return res.status(503).json({
          error: platform.message || 'SGDE no disponible.',
          encryptionReady: platform.encryptionReady,
        });
      }
      const acc = await requireCaseAccessForCaller(req, caseId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }
      const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
      if (authHdr.ok === false) {
        return res.status(authHdr.status).json({ error: authHdr.message });
      }
      const logged = await createLoggedInSgdeClientForUser(authHdr.admin, authHdr.userId);
      if ('error' in logged) {
        const status = logged.code === 'USER_NOT_CONFIGURED' ? 403 : 502;
        return res.status(status).json({ error: logged.error, code: logged.code });
      }
      const client = logged.client;
      const radDigits = String(acc.caseRow.radicado || '').replace(/\D/g, '');
      let rootId = String(acc.caseRow.sgde_id || '').trim();
      if (!rootId && radDigits.length === 23) {
        rootId = (await client.buscarExpedienteNodeId(radDigits)) || '';
      }
      if (!rootId) {
        return res.json({
          ok: false,
          code: 'NOT_FOUND',
          message:
            radDigits.length === 23
              ? 'No se encontró el expediente en SGDE para este radicado.'
              : 'Falta radicado de 23 dígitos o nodo SGDE vinculado.',
          linked: Boolean(acc.caseRow.sgde_id?.trim()),
          portalBaseUrl: logged.portalBaseUrl,
        });
      }
      const tree = await client.buildTree(rootId, { maxDepth: 8, maxNodes: 400 });
      return res.json({
        ok: true,
        rootId,
        tree,
        linked: Boolean(acc.caseRow.sgde_id?.trim()),
        portalBaseUrl: logged.portalBaseUrl,
      });
    } catch (error: unknown) {
      console.error('sgde/case-tree:', error);
      const msg = String((error as Error)?.message || error);
      return res.status(500).json({ error: msg || 'Error al consultar SGDE' });
    }
  });

  app.post('/api/sgde/link', async (req, res) => {
    try {
      const caseId = String((req.body as { caseId?: string })?.caseId || '').trim();
      if (!caseId) {
        return res.status(400).json({ error: 'caseId es requerido' });
      }
      const platform = sgdePlatformState();
      if (!platform.available) {
        return res.status(503).json({
          error: platform.message || 'SGDE no disponible.',
        });
      }
      const acc = await requireCaseAccessForCaller(req, caseId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }
      const radDigits = String(acc.caseRow.radicado || '').replace(/\D/g, '');
      if (radDigits.length !== 23) {
        return res.status(400).json({ error: 'El expediente no tiene un radicado válido de 23 dígitos para vincular.' });
      }
      const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
      if (authHdr.ok === false) {
        return res.status(authHdr.status).json({ error: authHdr.message });
      }
      const logged = await createLoggedInSgdeClientForUser(authHdr.admin, authHdr.userId);
      if ('error' in logged) {
        const status = logged.code === 'USER_NOT_CONFIGURED' ? 403 : 502;
        return res.status(status).json({ error: logged.error, code: logged.code });
      }
      const nodeId = await logged.client.buscarExpedienteNodeId(radDigits);
      if (!nodeId) {
        return res.status(404).json({ error: 'No se encontró el expediente en SGDE para este radicado.' });
      }
      const linkNow = new Date().toISOString();
      const { error: upErr } = await acc.admin
        .from('cases')
        .update({
          sgde_id: nodeId,
          sgde_linked_at: linkNow,
          sgde_sync_status: 'linked',
          updated_at: linkNow,
        })
        .eq('id', caseId)
        .eq('court_id', acc.caseRow.court_id);
      if (upErr) {
        console.error('sgde/link update:', upErr);
        return res.status(500).json({ error: upErr.message || 'No se pudo guardar sgde_id.' });
      }
      return res.json({ ok: true, sgdeId: nodeId, portalBaseUrl: logged.portalBaseUrl });
    } catch (error: unknown) {
      console.error('sgde/link:', error);
      const msg = String((error as Error)?.message || error);
      return res.status(500).json({ error: msg || 'Error al vincular SGDE' });
    }
  });

  app.get('/api/parse-session/:sessionId', async (req, res) => {
    sweepParseSessions();
    const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (authHdr.ok === false) {
      return res.status(authHdr.status).json({ error: authHdr.message });
    }
    const sessionId = String(req.params.sessionId || '');
    const session = getParseSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error:
          'Sesión de parseo expirada o inexistente (p. ej. reinicio del servidor). Vuelva a cargar el archivo .eml.',
      });
    }
    if (!parseSessionOwnedBy(session, authHdr.userId)) {
      return res.status(403).json({ error: 'No autorizado para esta sesión de parseo.' });
    }
    touchParseSession(sessionId);
    return res.json({
      parseSessionId: sessionId,
      attachments: session.attachments.map(({ buffer, ...meta }) => ({
        ...meta,
        hasBuffer: Boolean(buffer?.length),
      })),
    });
  });

  app.get('/api/parse-session/:sessionId/attachment/:index', async (req, res) => {
    sweepParseSessions();
    const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (authHdr.ok === false) {
      return res.status(authHdr.status).json({ error: authHdr.message });
    }
    const sessionId = String(req.params.sessionId || '');
    const i = parseInt(String(req.params.index), 10);
    if (!sessionId || Number.isNaN(i) || i < 0) {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }
    const session = getParseSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error:
          'Sesión de parseo expirada o inexistente (p. ej. reinicio del servidor). Vuelva a cargar el archivo .eml.',
      });
    }
    if (!parseSessionOwnedBy(session, authHdr.userId)) {
      return res.status(403).json({ error: 'No autorizado para esta sesión de parseo.' });
    }
    touchParseSession(sessionId);
    const row =
      session.attachments.find((a) => a.sessionIndex === i) ?? session.attachments[i];
    if (!row?.buffer?.length) {
      return res.status(404).json({ error: 'Adjunto no encontrado' });
    }
    res.setHeader('Content-Type', row.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(row.buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(row.buffer);
  });

  /** Sube un PDF (p. ej. unión local) a la sesión para poder previsualizarlo sin base64 en el cliente. */
  app.post(
    '/api/parse-session/:sessionId/upload',
    uploadLarge.single('file'),
    async (req, res) => {
      sweepParseSessions();
      const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
      if (authHdr.ok === false) {
        return res.status(authHdr.status).json({ error: authHdr.message });
      }
      const sessionId = String(req.params.sessionId || '');
      const session = getParseSession(sessionId);
      if (!session) {
        return res.status(404).json({
          error:
            'Sesión de parseo expirada o inexistente. Vuelva a cargar el archivo .eml antes de unir documentos.',
        });
      }
      if (!parseSessionOwnedBy(session, authHdr.userId)) {
        return res.status(403).json({ error: 'No autorizado para esta sesión de parseo.' });
      }
      const multerReq = req as Express.Request & {
        file?: { buffer: Buffer; originalname?: string; mimetype?: string; size: number };
      };
      const file = multerReq.file;
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'No se recibió el archivo PDF.' });
      }
      const bodyName =
        req.body && typeof req.body.filename === 'string' ? String(req.body.filename).trim() : '';
      const filename =
        bodyName ||
        String(file.originalname || 'DocumentosUnificados').replace(/\.[^.]+$/, '') ||
        'DocumentosUnificados';
      const contentType =
        (file.mimetype && String(file.mimetype)) ||
        (typeof req.body?.contentType === 'string' ? req.body.contentType : '') ||
        'application/pdf';
      const isFromLink = String(req.body?.isFromLink || '') === 'true';
      const merged = appendParseSessionAttachments(sessionId, [
        {
          filename,
          originalName: filename,
          contentType,
          size: file.buffer.length,
          isFromLink,
          buffer: file.buffer,
        },
      ]);
      if (!merged) {
        return res.status(404).json({ error: 'No se pudo guardar el adjunto en la sesión.' });
      }
      const row = merged[merged.length - 1];
      touchParseSession(sessionId);
      return res.json({
        ok: true,
        parseSessionId: sessionId,
        attachment: {
          sessionIndex: row.sessionIndex,
          filename: row.filename,
          originalName: row.originalName,
          contentType: row.contentType,
          size: row.size,
          isFromLink: row.isFromLink,
        },
      });
    },
  );

  /** Crea sesión vacía o con un PDF (cuando aún no hay parseSessionId, p. ej. unión offline). */
  app.post('/api/parse-session', uploadLarge.single('file'), async (req, res) => {
    sweepParseSessions();
    const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (authHdr.ok === false) {
      return res.status(authHdr.status).json({ error: authHdr.message });
    }
    const multerReq = req as Express.Request & {
      file?: { buffer: Buffer; originalname?: string; mimetype?: string; size: number };
    };
    const file = multerReq.file;
    if (!file?.buffer?.length) {
      const id = createParseSession([], authHdr.userId);
      return res.json({ parseSessionId: id, attachments: [] });
    }
    const bodyName =
      req.body && typeof req.body.filename === 'string' ? String(req.body.filename).trim() : '';
    const filename =
      bodyName ||
      String(file.originalname || 'Documento').replace(/\.[^.]+$/, '') ||
      'Documento';
    const contentType = (file.mimetype && String(file.mimetype)) || 'application/pdf';
    const id = createParseSession(
      [
        {
          sessionIndex: 0,
          order: 0,
          filename,
          originalName: filename,
          contentType,
          size: file.buffer.length,
          isFromLink: String(req.body?.isFromLink || '') === 'true',
          buffer: file.buffer,
        },
      ],
      authHdr.userId,
    );
    return res.json({
      parseSessionId: id,
      attachment: {
        sessionIndex: 0,
        filename,
        originalName: filename,
        contentType,
        size: file.buffer.length,
        isFromLink: String(req.body?.isFromLink || '') === 'true',
      },
    });
  });

  /** Descarga el PDF/ZIP del portal (Demanda en línea) y lo agrega a la sesión (~30–90 s para ~50 MB). */
  app.post('/api/parse-session/:sessionId/fetch-archive', async (req, res) => {
    sweepParseSessions();
    const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (authHdr.ok === false) {
      return res.status(authHdr.status).json({ error: authHdr.message });
    }
    const sessionId = String(req.params.sessionId || '');
    const session = getParseSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error:
          'Sesión de parseo expirada o inexistente (p. ej. reinicio del servidor). Vuelva a cargar el archivo .eml.',
      });
    }
    if (!parseSessionOwnedBy(session, authHdr.userId)) {
      return res.status(403).json({ error: 'No autorizado para esta sesión de parseo.' });
    }
    const bodyUrl =
      req.body && typeof req.body.url === 'string' ? String(req.body.url).trim() : '';
    const rawUrl = bodyUrl || session.linkUrl || '';
    const url = unwrapJudicialArchiveUrl(rawUrl);
    if (!url) {
      return res.status(400).json({ error: 'No hay URL de Archivo / Demanda en línea para descargar.' });
    }
    try {
      await assertSafeJudicialArchiveUrl(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'URL de archivo no permitida.';
      return res.status(400).json({ error: msg, linkUrl: url });
    }
    const alreadyFromLink = session.attachments.some((a) => a.isFromLink);
    if (alreadyFromLink) {
      const publicAttachments = session.attachments.map(({ buffer, ...meta }) => ({
        ...meta,
        ...(buffer.length > 0 && buffer.length <= 14 * 1024 * 1024
          ? { content: buffer.toString('base64') }
          : {}),
      }));
      return res.json({
        ok: true,
        alreadyFetched: true,
        attachments: publicAttachments,
        linkUrl: url,
      });
    }
    try {
      console.log('[parse-session/fetch-archive] Descargando', url.slice(0, 140));
      const t0 = Date.now();
      const beforeCount = session.attachments.length;
      const rows = await fetchJudicialArchiveFromUrl(url);
      if (!rows.length) {
        markParseSessionLinkError(
          sessionId,
          'El portal no devolvió PDF/ZIP (HTML o vacío). Revise el enlace o agregue el archivo manualmente.',
        );
        return res.status(502).json({
          error:
            'No se pudo obtener el expediente del enlace. El portal no devolvió un PDF/ZIP descargable.',
          linkUrl: url,
        });
      }
      const merged = appendParseSessionAttachments(
        sessionId,
        rows.map(({ sessionIndex: _i, order: _o, ...rest }) => rest),
      );
      if (!merged) {
        return res.status(404).json({ error: 'Sesión de parseo no encontrada al guardar adjuntos.' });
      }
      console.log(
        `[parse-session/fetch-archive] OK ${rows.length} pieza(s) en ${Date.now() - t0}ms, ${(rows[0]?.size || 0)} bytes`
      );
      const MAX_INLINE = 14 * 1024 * 1024;
      const publicAttachments = merged.map(({ buffer, ...meta }) => ({
        ...meta,
        ...(buffer.length > 0 && buffer.length <= MAX_INLINE
          ? { content: buffer.toString('base64') }
          : {}),
      }));
      const added = merged.slice(beforeCount).map((r) => ({
        filename: r.filename,
        size: r.size,
        contentType: r.contentType,
        sessionIndex: r.sessionIndex,
        isFromLink: r.isFromLink,
      }));
      return res.json({
        ok: true,
        alreadyFetched: false,
        attachments: publicAttachments,
        added,
        linkUrl: url,
        elapsedMs: Date.now() - t0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[parse-session/fetch-archive]', error);
      markParseSessionLinkError(sessionId, msg);
      const status = error instanceof UnsafeJudicialArchiveUrlError ? 400 : 502;
      return res.status(status).json({
        error: `Error al descargar el enlace Archivo: ${msg}`,
        linkUrl: url,
      });
    }
  });

  // Handle EML/MSG upload and parsing
  app.post('/api/parse-email', upload.single('email'), async (req, res) => {
    console.log('Received request for /api/parse-email');
    const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (authHdr.ok === false) {
      return res.status(authHdr.status).json({ error: authHdr.message });
    }
    const multerReq = req as any;
    console.log('File details:', multerReq.file ? {
      originalname: multerReq.file.originalname,
      mimetype: multerReq.file.mimetype,
      size: multerReq.file.size
    } : 'No file');

    try {
      if (!multerReq.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const result = await parseJudicialEmailFromBuffer(multerReq.file.buffer, authHdr.userId);
      const text = typeof result.text === 'string' ? result.text : '';
      const html = typeof result.html === 'string' ? result.html : '';
      const subject = String(result.subject || '');
      let segundaInstancia;
      try {
        segundaInstancia = parseSegundaInstanciaFromEmail(subject, text, html);
      } catch (siErr) {
        console.error('segundaInstancia parse (no bloquea correo):', siErr);
        segundaInstancia = {
          isSegundaInstancia: false,
          originRadicado: null,
          originCourt: null,
          motivo: null,
          sentenciaFecha: null,
          repartoSecuencia: null,
          sgdeNodeId: null,
          appellant: null,
          originRuling: null,
        };
      }
      const session = getParseSession(result.parseSessionId);
      if (
        session?.attachments?.length &&
        shouldDigestPdfsForSegundaInstancia(subject, text, html, segundaInstancia)
      ) {
        try {
          const digestPromise = digestPdfAttachmentsForSegundaInstancia(session.attachments, {
            maxPdfs: 3,
          });
          const timeoutPromise = new Promise<string>((resolve) => {
            setTimeout(() => resolve(''), 12_000);
          });
          const pdfDigest = await Promise.race([digestPromise, timeoutPromise]);
          if (pdfDigest.trim()) {
            segundaInstancia = parseSegundaInstanciaFromEmail(
              subject,
              `${text}\n${pdfDigest}`,
              html
            );
          }
        } catch (pdfDigErr) {
          console.warn('digest PDF segunda instancia:', pdfDigErr);
        }
      }
      res.json({ ...result, segundaInstancia });
    } catch (error) {
      console.error('Email parsing error:', error);
      res.status(500).json({ error: 'Failed to parse email' });
    }
  });

  app.post('/api/ai/summarize', async (req, res) => {
    try {
      const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
      if (authHdr.ok === false) {
        return res.status(authHdr.status).json({ error: authHdr.message });
      }
      const body = req.body || {};
      const claim = String(body.claim || '');
      const rawText = typeof body.rawText === 'string' ? body.rawText : '';
      const contextBlock = typeof body.contextBlock === 'string' ? body.contextBlock : '';
      const caseType = body.caseType ? String(body.caseType) : null;
      const catalogMetadata =
        body.catalogMetadata && typeof body.catalogMetadata === 'object'
          ? (body.catalogMetadata as Record<string, unknown>)
          : null;

      const openai = getOpenAiClient();
      const text = await generateCaseSynthesis(openai, {
        radicado: String(body.radicado || ''),
        caseType,
        claimant: claim,
        defendant: String(body.defendant || ''),
        subject: body.subject ? String(body.subject) : null,
        status: body.status ? String(body.status) : null,
        operationalStatus: body.operationalStatus ? String(body.operationalStatus) : null,
        deadlineAt: body.deadlineAt ? String(body.deadlineAt) : null,
        assignedTo: body.assignedTo ? String(body.assignedTo) : null,
        legalHechos: body.legalHechos ? String(body.legalHechos) : null,
        legalPretensiones: body.legalPretensiones ? String(body.legalPretensiones) : null,
        legalDerechoTutelado: body.legalDerechoTutelado ? String(body.legalDerechoTutelado) : null,
        rawText: rawText || null,
        catalogMetadata,
        documentTitles: Array.isArray(body.documentTitles)
          ? body.documentTitles.map((t: unknown) => String(t)).filter(Boolean)
          : undefined,
        actionLines: Array.isArray(body.actionLines)
          ? body.actionLines.map((t: unknown) => String(t)).filter(Boolean)
          : undefined,
      });

      if (!text.trim() && !rawText.trim() && !contextBlock.trim()) {
        return res.status(400).json({ error: 'Sin datos suficientes para sintetizar el expediente.' });
      }

      return res.json({ text });
    } catch (error: any) {
      console.error('OpenAI summarize error:', error);
      const mapped = mapAiError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/ai/analyze-piece', async (req, res) => {
    try {
      const body = req.body || {};
      const caseId = String(body.caseId || '').trim();
      const caseDocumentId = String(body.caseDocumentId || '').trim();
      const forceRefresh = Boolean(body.forceRefresh);
      const rawPageCount = Number(body.pdfPageCount);
      const pdfPageCountHint =
        Number.isFinite(rawPageCount) && rawPageCount > 0 ? Math.floor(rawPageCount) : null;

      if (!caseId || !caseDocumentId) {
        return res.status(400).json({ error: 'caseId y caseDocumentId son requeridos' });
      }

      const acc = await requireCaseAccessForCaller(req, caseId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }

      const authHdr = String(req.headers.authorization || '');
      const m = /^Bearer\s+(.+)$/i.exec(authHdr);
      const token = m?.[1]?.trim();
      if (!token) {
        return res.status(401).json({ error: 'Se requiere sesión (Authorization: Bearer).' });
      }
      const { data: authData, error: authErr } = await acc.admin.auth.getUser(token);
      if (authErr || !authData?.user?.id) {
        return res.status(401).json({ error: 'Sesión inválida o expirada.' });
      }

      const uid = authData.user.id;
      const meta = authData.user.user_metadata as Record<string, unknown> | undefined;
      const userName =
        (typeof meta?.full_name === 'string' && meta.full_name.trim()) ||
        authData.user.email ||
        'Sistema';

      const openai = getOpenAiClient();

      let sgdeClient: import('./server/sgde-client.js').SgdeClient | null = null;
      const platform = sgdePlatformState();
      if (platform.available) {
        const logged = await createLoggedInSgdeClientForUser(acc.admin, uid);
        if (!('error' in logged)) sgdeClient = logged.client;
      }

      const out = await analyzeCaseDocumentPiece({
        admin: acc.admin,
        openai,
        userId: uid,
        userName: String(userName),
        caseId,
        caseDocumentId,
        forceRefresh,
        sgdeClient,
        pdfPageCountHint,
      });

      return res.json({
        cached: out.cached,
        contentHash: out.contentHash,
        pageCountSent: out.pageCountSent,
        analysisData: out.analysisData,
        summaryMarkdown: out.summaryMarkdown,
        analyzedAt: out.analyzedAt,
      });
    } catch (error: unknown) {
      const status = typeof (error as { status?: number }).status === 'number'
        ? (error as { status: number }).status
        : 500;
      const message =
        error instanceof Error ? error.message : 'Error al analizar la pieza procesal.';
      if (status >= 500) console.error('OpenAI analyze-piece error:', error);
      if (status < 500) {
        return res.status(status).json({ error: message });
      }
      const mapped = mapAiError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/ai/review-text', async (req, res) => {
    try {
      const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
      if (authHdr.ok === false) {
        return res.status(authHdr.status).json({ error: authHdr.message });
      }
      const body = (req.body ?? {}) as { text?: string; documentLabel?: string };
      const text = String(body.text || '').trim();
      if (!text) {
        return res.status(400).json({ error: 'text es requerido.' });
      }
      const openai = getOpenAiClient();
      const out = await reviewJudicialText(openai, {
        text,
        documentLabel: body.documentLabel,
      });
      return res.json({
        ok: true,
        summary: out.summary,
        correctedText: out.correctedText,
        issues: out.issues,
        model: out.model,
        promptVersion: out.promptVersion,
      });
    } catch (error: unknown) {
      const status = typeof (error as { status?: number }).status === 'number'
        ? (error as { status: number }).status
        : 500;
      const message = error instanceof Error ? error.message : 'Error al revisar el texto.';
      if (status >= 500) console.error('ai/review-text:', error);
      if (status < 500) return res.status(status).json({ error: message });
      const mapped = mapAiError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/ai/legal-analysis', async (req, res) => {
    try {
      const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
      if (authHdr.ok === false) {
        return res.status(authHdr.status).json({ error: authHdr.message });
      }
      const body = req.body || {};
      // Compat: rechazar prompt inyectado desde cliente (prompt vive en servidor).
      if (body.prompt != null && String(body.prompt).trim()) {
        console.warn('[legal-analysis] se ignoró prompt enviado por el cliente');
      }
      const caseType = String(body.caseType || '').trim();
      const pdfBase64Raw = body.pdfBase64 != null ? String(body.pdfBase64) : '';
      const pdfText = body.pdfText != null ? String(body.pdfText) : '';
      if (!caseType) {
        return res.status(400).json({ error: 'caseType es requerido (civil|tutela|impugnacion|consulta)' });
      }
      if (!pdfBase64Raw.trim() && !pdfText.trim()) {
        return res.status(400).json({ error: 'pdfBase64 o pdfText es requerido' });
      }

      const { slicePdfBase64FirstPages, LEGAL_ANALYSIS_MAX_PAGES } = await import(
        './server/pdf-first-pages'
      );
      let sliced = {
        base64: '',
        totalPages: 0,
        usedPages: 0,
        truncated: false,
      };
      if (pdfBase64Raw.trim()) {
        try {
          sliced = await slicePdfBase64FirstPages(pdfBase64Raw, LEGAL_ANALYSIS_MAX_PAGES);
        } catch (sliceErr) {
          console.warn('legal-analysis: no se pudo recortar PDF, se envía completo:', sliceErr);
          sliced = {
            base64: pdfBase64Raw.replace(/^data:application\/pdf;base64,/i, ''),
            totalPages: 0,
            usedPages: 0,
            truncated: false,
          };
        }
        if (sliced.truncated) {
          console.log(
            `[legal-analysis] PDF recortado a primeras ${sliced.usedPages}/${sliced.totalPages} páginas`,
          );
        }
      }

      const openai = getOpenAiClient();
      const { analysis, lengthOk, promptVersion } = await runLegalAnalysisWithOpenAi(openai, {
        caseType,
        documentKind:
          body.documentKind === 'fallo_primera' ? 'fallo_primera' : 'radicacion',
        pdfBase64: sliced.base64 || undefined,
        pdfText: pdfText.trim() || undefined,
        pdfWasTruncated: sliced.truncated,
        truncatedToPages: sliced.truncated ? sliced.usedPages : undefined,
        totalPages: sliced.totalPages || undefined,
      });

      return res.json({
        text: JSON.stringify(analysis),
        analysis,
        lengthOk,
        promptVersion,
        pdfPagesTotal: sliced.totalPages || null,
        pdfPagesUsed: sliced.usedPages || null,
        pdfTruncated: sliced.truncated,
      });
    } catch (error: any) {
      console.error('OpenAI legal-analysis error:', error);
      if (error?.name === 'ZodError') {
        return res.status(400).json({ error: error.message || 'Solicitud inválida' });
      }
      const mapped = mapAiError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.use('/api/precedents', createPrecedentsFileRouter(upload, handlePrecedentsIndexFromFile, handlePrecedentsAttachPdf));

  app.post('/api/precedents/index', async (req, res) => {
    try {
      const b = req.body || {};
      const caseId = String(b.caseId || '').trim();
      const courtId = String(b.courtId || '').trim();
      const radicado = normalizeRadicado(String(b.radicado || '').trim());
      const rightProtected = String(b.rightProtected || '').trim();
      const rulingSense = String(b.rulingSense || '').trim();
      const legalArguments = String(b.legalArguments || '').trim();
      const summary = String(b.summary || '').trim();
      const decisionDateRaw = b.decisionDate != null ? String(b.decisionDate).trim() : '';
      const decisionDate = decisionDateRaw ? decisionDateRaw.slice(0, 10) : null;
      const tags = Array.isArray(b.tags) ? b.tags : [];
      const legalSpecialty = resolveLegalSpecialtyForPrecedent(
        String(b.legalSpecialty || b.legal_specialty || ''),
        radicado
      );
      const issuerCategory = resolveIssuerCategoryForPrecedent(
        String(b.issuerCategory || b.issuer_category || ''),
        String(b.sourceCorporation || ''),
        String(b.issuerCategory || b.issuer_category || '')
      );
      const sourceTypeRaw = String(b.sourceType || 'despacho').trim().toLowerCase();
      const sourceType = sourceTypeRaw === 'jurisprudencia' ? 'jurisprudencia' : 'despacho';
      const sourceCorporation =
        sourceType === 'jurisprudencia' ? String(b.sourceCorporation || '').trim() || null : null;

      if (!courtId || !radicado) {
        return res.status(400).json({ error: 'courtId y radicado son requeridos' });
      }
      const acc = await requireCallerCourtAccess(req, courtId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }
      if (sourceType === 'jurisprudencia' && !sourceCorporation) {
        return res.status(400).json({ error: 'sourceCorporation es requerido para jurisprudencia de referencia' });
      }

      let defendantOut = String(b.defendant || '').trim();
      if (sourceType === 'jurisprudencia' && !defendantOut) {
        defendantOut = '—';
      }

      const openai = getOpenAiClient();
      const supabase = getSupabaseAdmin();
      const data = await insertPrecedentRow({
        openai,
        supabase,
        courtId,
        caseId: caseId || null,
        sourceType,
        sourceCorporation,
        radicado,
        rightProtected,
        defendant: defendantOut,
        rulingSense,
        legalArguments,
        summary,
        decisionDate,
        tags,
        legalSpecialty,
        issuerCategory,
      });
      return res.json({ precedent: data });
    } catch (error: any) {
      console.error('precedents/index:', error);
      const msg = String(error?.message || '');
      if (msg.includes('Faltan SUPABASE') || msg.includes('SUPABASE_SERVICE_ROLE')) {
        return res.status(503).json({ error: msg });
      }
      const mapped = mapAiError(error);
      if (mapped.status !== 500) {
        return res.status(mapped.status).json({ error: mapped.message });
      }
      return res.status(500).json({ error: msg || 'Error al indexar precedente' });
    }
  });

  app.get('/api/precedents', async (req, res) => {
    try {
      const courtId = String(req.query.courtId || '').trim();
      if (!courtId) {
        return res.status(400).json({ error: 'courtId es requerido' });
      }
      const acc = await requireCallerCourtAccess(req, courtId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }

      const sourceTypeRaw = String(req.query.sourceType || '').trim().toLowerCase();
      let query = acc.admin
        .from('precedents')
        .select(PRECEDENT_ROW_SELECT, { count: 'exact' })
        .eq('court_id', courtId);
      if (sourceTypeRaw === 'despacho' || sourceTypeRaw === 'jurisprudencia') {
        query = query.eq('source_type', sourceTypeRaw);
      }

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '25'), 10) || 25));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order('decision_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;

      return res.json({ precedents: data ?? [], total: count ?? 0 });
    } catch (error: any) {
      console.error('precedents/list:', error);
      const msg = String(error?.message || '');
      if (msg.includes('Faltan SUPABASE') || msg.includes('SUPABASE_SERVICE_ROLE')) {
        return res.status(503).json({ error: msg });
      }
      return res.status(500).json({ error: msg || 'Error al listar precedentes' });
    }
  });

  app.post('/api/precedents/search', async (req, res) => {
    try {
      const b = req.body || {};
      const courtId = String(b.courtId || '').trim();
      const queryText = typeof b.queryText === 'string' ? b.queryText : '';
      if (!courtId) {
        return res.status(400).json({ error: 'courtId es requerido' });
      }
      if (!queryText.trim()) {
        return res.json({ results: [] });
      }

      const acc = await requireCallerCourtAccess(req, courtId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }

      const openai = getOpenAiClient();
      const embedding = await createEmbedding1536(openai, queryText);
      const embStr = vectorToPgString(embedding);
      const supabase = getSupabaseAdmin();

      const { data: chunkRows, error: chunkErr } = await supabase.rpc('match_precedent_chunks', {
        query_embedding: embStr,
        match_court_id: courtId,
        match_count: PRECEDENT_SEARCH_CONFIG.CHUNK_LIMIT,
        match_threshold: PRECEDENT_SEARCH_CONFIG.CHUNK_MATCH_THRESHOLD,
      });

      if (!chunkErr && Array.isArray(chunkRows) && chunkRows.length > 0) {
        const aggregated = aggregateChunkMatches(
          chunkRows as MatchPrecedentChunkRow[],
          PRECEDENT_SEARCH_CONFIG.TOP_PRECEDENTS
        );
        const results = aggregated as unknown as Array<Record<string, unknown>>;
        await enrichPrecedentSearchResultsWithStoragePath(supabase, results);
        return res.json({ results: aggregated });
      }

      if (chunkErr) {
        console.warn('[precedents/search] match_precedent_chunks:', chunkErr.message);
      }

      const { data, error } = await supabase.rpc('match_precedents', {
        query_embedding: embStr,
        match_court_id: courtId,
        match_count: PRECEDENT_SEARCH_CONFIG.LEGACY_TOP,
        match_threshold: PRECEDENT_SEARCH_CONFIG.LEGACY_MATCH_THRESHOLD,
      });
      if (error) throw error;
      const legacy = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
        ...row,
        matched_snippet: null,
        matched_chunk_index: null,
        matched_char_start: null,
        matched_char_end: null,
      }));
      await enrichPrecedentSearchResultsWithStoragePath(supabase, legacy);
      return res.json({ results: legacy });
    } catch (error: any) {
      console.error('precedents/search:', error);
      const msg = String(error?.message || '');
      if (msg.includes('Faltan SUPABASE') || msg.includes('SUPABASE_SERVICE_ROLE')) {
        return res.status(503).json({ error: msg });
      }
      const mapped = mapAiError(error);
      if (mapped.status !== 500) {
        return res.status(mapped.status).json({ error: mapped.message });
      }
      return res.status(500).json({ error: msg || 'Error en búsqueda de precedentes' });
    }
  });

  app.get('/api/precedents/:id/pdf-url', async (req, res) => {
    try {
      const precedentId = String(req.params.id || '').trim();
      if (!precedentId) {
        return res.status(400).json({ error: 'id es requerido' });
      }
      const acc = await requirePrecedentAccessForCaller(req, precedentId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }
      const { data: signed, error: signErr } = await acc.admin.storage
        .from(CASE_DOCUMENTS_BUCKET)
        .createSignedUrl(acc.sourceStoragePath, PRECEDENT_PDF_SIGNED_URL_TTL_SEC);
      if (signErr || !signed?.signedUrl) {
        console.error('precedents/pdf-url signed:', signErr?.message);
        return res.status(500).json({ error: 'No se pudo generar el enlace al PDF.' });
      }
      return res.json({ url: signed.signedUrl });
    } catch (error: any) {
      console.error('precedents/pdf-url:', error);
      const msg = String(error?.message || '');
      if (msg.includes('Faltan SUPABASE') || msg.includes('SUPABASE_SERVICE_ROLE')) {
        return res.status(503).json({ error: msg });
      }
      return res.status(500).json({ error: msg || 'Error al obtener URL del PDF' });
    }
  });

  app.patch('/api/precedents/:id', async (req, res) => {
    try {
      const precedentId = String(req.params.id || '').trim();
      if (!precedentId) {
        return res.status(400).json({ error: 'id es requerido' });
      }
      const acc = await requirePrecedentCourtAccessForCaller(req, precedentId);
      if (acc.ok === false) {
        return res.status(acc.status).json({ error: acc.message });
      }

      const b = req.body || {};
      const patch: Record<string, unknown> = {};
      if (b.radicado !== undefined) {
        const r = normalizeRadicado(String(b.radicado ?? ''));
        if (!r) {
          return res.status(400).json({ error: 'radicado no puede quedar vacío' });
        }
        patch.radicado = r;
      }
      if (b.ruling_sense !== undefined) {
        patch.ruling_sense = String(b.ruling_sense ?? '').trim();
      }
      if (b.decision_date !== undefined) {
        const raw = b.decision_date == null ? '' : String(b.decision_date).trim();
        patch.decision_date = raw ? parseDecisionDateYmd(raw) : null;
      }
      if (b.right_protected !== undefined) {
        patch.right_protected = String(b.right_protected ?? '').trim();
      }
      if (b.summary !== undefined) {
        patch.summary = String(b.summary ?? '').trim();
      }
      if (b.legal_arguments !== undefined) {
        patch.legal_arguments = String(b.legal_arguments ?? '').trim();
      }
      if (b.legal_specialty !== undefined) {
        const spec = normalizeLegalSpecialty(String(b.legal_specialty ?? ''));
        if (!spec) {
          return res.status(400).json({ error: 'legal_specialty no válida' });
        }
        patch.legal_specialty = spec;
      }
      if (b.issuer_category !== undefined) {
        const cat = normalizeIssuerCategory(String(b.issuer_category ?? ''));
        if (!cat) {
          return res.status(400).json({ error: 'issuer_category no válida' });
        }
        patch.issuer_category = cat;
      }

      const allowed = [
        'radicado',
        'ruling_sense',
        'decision_date',
        'right_protected',
        'summary',
        'legal_arguments',
        'legal_specialty',
        'issuer_category',
      ] as const;
      const extra = Object.keys(b).filter((k) => !allowed.includes(k as (typeof allowed)[number]));
      if (extra.length) {
        return res.status(400).json({ error: `Campos no permitidos: ${extra.join(', ')}` });
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Nada que actualizar' });
      }

      const { data, error } = await acc.admin
        .from('precedents')
        .update(patch)
        .eq('id', precedentId)
        .select(PRECEDENT_ROW_SELECT)
        .single();
      if (error) throw error;

      const body: { precedent: typeof data; reindex_warning?: string } = { precedent: data };
      try {
        const openai = getOpenAiClient();
        await reindexPrecedent(precedentId, acc.admin, openai);
      } catch (reindexErr) {
        console.error('precedents/patch reindex:', reindexErr);
        body.reindex_warning = 'Metadatos guardados. Reindexación pendiente.';
      }
      return res.json(body);
    } catch (error: any) {
      console.error('precedents/patch:', error);
      const msg = String(error?.message || '');
      if (msg.includes('Faltan SUPABASE') || msg.includes('SUPABASE_SERVICE_ROLE')) {
        return res.status(503).json({ error: msg });
      }
      return res.status(500).json({ error: msg || 'Error al actualizar precedente' });
    }
  });

  /** Rutas plantilla-docx en Router montado (evita conflictos con el 404 genérico `/api` en Express 4). */
  type UploadedDocx = { buffer: Buffer; originalname?: string };
  const plantillaDocxRouter = express.Router();
  plantillaDocxRouter.use(async (req, res, next) => {
    const authHdr = await requireAuthenticatedCaller(req, getSupabaseAdmin);
    if (authHdr.ok === false) {
      return res.status(authHdr.status).json({ error: authHdr.message });
    }
    next();
  });
  plantillaDocxRouter.post('/analizar', upload.single('archivo'), async (req, res) => {
    try {
      const multerReq = req as Express.Request & { file?: UploadedDocx };
      const file = multerReq.file;
      const tipoRaw = String((req.body as { tipo?: string })?.tipo ?? 'libre');
      const tipo: DocumentTemplateTipo =
        tipoRaw === 'informe_ingreso' ||
        tipoRaw === 'auto_admisorio' ||
        tipoRaw === 'auto_tramite' ||
        tipoRaw === 'sentencia' ||
        tipoRaw === 'notificacion_admisorio' ||
        tipoRaw === 'notificacion_fallo' ||
        tipoRaw === 'oficio_juzgado' ||
        tipoRaw === 'oficio_comision' ||
        tipoRaw === 'oficio_requerimiento' ||
        tipoRaw === 'oficio_competencia' ||
        tipoRaw === 'libre'
          ? tipoRaw
          : 'libre';
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'Adjunte un archivo .docx' });
      }
      const lower = file.originalname?.toLowerCase() ?? '';
      if (!lower.endsWith('.docx')) {
        return res.status(400).json({ error: 'Solo se admiten archivos .docx' });
      }
      const texto = await extraerTextoPlanoDocx(Buffer.from(file.buffer));
      const catalogo = catalogoTextoParaPromptIA(tipo);
      const suggestions = await analizarVariablesDocxConIa(texto, catalogo);
      const muestra = texto.length > 80000 ? texto.slice(0, 80000) : texto;
      return res.json({
        textoPlanoMuestra: muestra,
        textoPlanoLength: texto.length,
        suggestions,
      });
    } catch (error: any) {
      console.error('plantilla-docx analizar:', error);
      const mapped = mapAiError(error);
      return res.status(mapped.status).json({ error: mapped.message });
    }
  });
  plantillaDocxRouter.post('/aplicar', upload.single('archivo'), async (req, res) => {
    try {
      const multerReq = req as Express.Request & { file?: UploadedDocx };
      const file = multerReq.file;
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'Adjunte el archivo .docx' });
      }
      let mappings: Array<{ original: string; marcador: string }> = [];
      try {
        mappings = JSON.parse(String((req.body as { mappings?: string })?.mappings ?? '[]')) as Array<{
          original: string;
          marcador: string;
        }>;
      } catch {
        return res.status(400).json({ error: 'El campo mappings no es JSON válido' });
      }
      if (!Array.isArray(mappings)) {
        return res.status(400).json({ error: 'mappings debe ser un array' });
      }
      const processed = await aplicarMapeoEnDocx(Buffer.from(file.buffer), mappings);
      const previewText = await extraerTextoPlanoDocx(processed);
      return res.json({
        processedBase64: processed.toString('base64'),
        previewText: previewText.length > 120000 ? previewText.slice(0, 120000) : previewText,
      });
    } catch (error: any) {
      console.error('plantilla-docx aplicar:', error);
      return res.status(500).json({ error: error?.message || 'Error al procesar el documento' });
    }
  });
  app.use('/api/plantilla-docx', plantillaDocxRouter);

  // Error handler for API routes
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'El documento es demasiado grande para procesarlo por API. Intente un archivo mas pequeno.'
      });
    }
    console.error('API Error:', err);
    const isProd = process.env.NODE_ENV === 'production';
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      ...(isProd ? {} : { details: err.stack }),
    });
  });

  // 404 solo para rutas /api que no existen (no usar app.all('/api/*'): en Express 4.* puede fallar el matcheo de rutas POST concretas).
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.originalUrl.startsWith('/api')) {
      return next();
    }
    if (res.headersSent) {
      return next();
    }
    res.status(404).json({ error: `API route ${req.method} ${req.originalUrl} not found` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
