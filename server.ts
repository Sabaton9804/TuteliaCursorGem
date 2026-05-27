import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import axios from 'axios';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  extraerTextoPlanoDocx,
  aplicarMapeoEnDocx,
  analizarVariablesDocxConIa,
} from './docx-plantilla-server';
import { catalogoTextoParaPromptIA } from './src/lib/plantilla-marcadores-catalog.ts';
import type { DocumentTemplateTipo } from './src/types.ts';
import { detectActaRepartoInPdfBuffer } from './pdf-acta-detect';
import { createPrecedentsFileRouter } from './precedents-routes';
import { SgdeClient, getDefaultSgdeBaseUrl } from './server/sgde-client';
import { getParseSession, sweepParseSessions, touchParseSession } from './server/parse-email-sessions';
import { parseJudicialEmailFromBuffer } from './server/parse-judicial-email';
import {
  digestPdfAttachmentsForSegundaInstancia,
  parseSegundaInstanciaFromEmail,
} from './server/sgde-segunda-instancia-parse';
import { registerOutlookRoutes } from './server/outlook-routes';
import { registerSgdeRoutes } from './server/sgde-routes';
import { createLoggedInSgdeClientForUser, sgdePlatformState } from './server/sgde-integration';
import { isSgdeTlsInsecure } from './server/sgde-tls';
import { requireAuthenticatedCaller } from './server/outlook-auth';
import {
  aggregateChunkMatches,
  buildChunksForPrecedent,
  createEmbedding1536,
  embedTextsBatch,
  insertPrecedentChunkRows,
  vectorToPgString,
  type MatchPrecedentChunkRow,
} from './server/precedent-chunks-service.js';
import {
  extractRadicado23FromText,
  normalizeRadicado,
  PRECEDENT_RADICADO_PENDIENTE,
} from './server/precedent-radicado.js';
import { createOpenAiTlsInsecureFetch } from './server/openai-insecure-fetch.js';
import { analyzeCaseDocumentPiece } from './server/analyze-piece-service.js';

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
  console.log(
    `[tutelia] OPENAI_API_KEY: ${hasOpenAi ? 'OK' : 'NO'}. ` +
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

const PORT = 3000;
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

async function requireCaseAccessForCaller(
  req: express.Request,
  caseId: string
): Promise<
  | { ok: true; admin: SupabaseClient; caseRow: SgdeCaseRow }
  | { ok: false; status: number; message: string }
> {
  const authHdr = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(authHdr);
  const token = m?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, message: 'Se requiere sesión (Authorization: Bearer).' };
  }
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    return { ok: false, status: 503, message: String((e as Error)?.message || 'Supabase no configurado en servidor.') };
  }
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user?.id) {
    return { ok: false, status: 401, message: 'Sesión inválida o expirada.' };
  }
  const uid = authData.user.id;
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('court_id')
    .eq('id', uid)
    .maybeSingle();
  if (profErr || !prof?.court_id) {
    return { ok: false, status: 403, message: 'Perfil sin despacho asignado.' };
  }
  const profileCourt = String(prof.court_id);
  const { data: row, error: caseErr } = await admin
    .from('cases')
    .select('id, court_id, radicado, sgde_id')
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !row?.id) {
    return { ok: false, status: 404, message: 'Expediente no encontrado.' };
  }
  if (String(row.court_id) !== profileCourt) {
    return { ok: false, status: 403, message: 'No autorizado para este expediente.' };
  }
  return {
    ok: true,
    admin,
    caseRow: {
      id: String(row.id),
      court_id: String(row.court_id),
      radicado: row.radicado != null ? String(row.radicado) : null,
      sgde_id: row.sgde_id != null ? String(row.sgde_id) : null,
    },
  };
}

type PrecedentSourceType = 'despacho' | 'jurisprudencia';

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
  'id, court_id, source_case_id, source_type, source_corporation, radicado, right_protected, defendant, ruling_sense, legal_arguments, summary, decision_date, tags, source_storage_path, created_at, updated_at';

async function requirePrecedentCourtAccessForCaller(
  req: express.Request,
  precedentId: string
): Promise<
  | { ok: true; admin: SupabaseClient; courtId: string; precedent: Record<string, unknown> }
  | { ok: false; status: number; message: string }
> {
  const authHdr = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(authHdr);
  const token = m?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, message: 'Se requiere sesión (Authorization: Bearer).' };
  }
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    return { ok: false, status: 503, message: String((e as Error)?.message || 'Supabase no configurado en servidor.') };
  }
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user?.id) {
    return { ok: false, status: 401, message: 'Sesión inválida o expirada.' };
  }
  const uid = authData.user.id;
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('court_id')
    .eq('id', uid)
    .maybeSingle();
  if (profErr || !prof?.court_id) {
    return { ok: false, status: 403, message: 'Perfil sin despacho asignado.' };
  }
  const profileCourt = String(prof.court_id);
  const { data: prec, error: precErr } = await admin
    .from('precedents')
    .select(PRECEDENT_ROW_SELECT)
    .eq('id', precedentId)
    .maybeSingle();
  if (precErr || !prec?.id) {
    return { ok: false, status: 404, message: 'Precedente no encontrado.' };
  }
  if (String(prec.court_id) !== profileCourt) {
    return { ok: false, status: 403, message: 'No autorizado para este precedente.' };
  }
  return { ok: true, admin, courtId: profileCourt, precedent: prec as Record<string, unknown> };
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
  const embStr0 = vectorToPgString(vectors[0]);

  if (logIndexFromFileDebug) {
    console.log(
      '[precedents/index-from-file] fragmentos:',
      chunks.length,
      '; vector padre (= chunk 0), dimensión=',
      vectors[0]?.length
    );
    console.log('[precedents/index-from-file] longitud string pgvector padre:', embStr0.length);
  }

  const { data, error } = await supabase
    .from('precedents')
    .insert({
      court_id: courtId,
      source_case_id: caseId || null,
      source_type: sourceType,
      source_corporation: sourceCorporation,
      radicado: radicadoNorm,
      right_protected: rightProtected,
      defendant,
      ruling_sense: rulingSense,
      legal_arguments: legalArguments,
      summary,
      decision_date: decisionDate,
      tags,
      embedding: embStr0,
    })
    .select(PRECEDENT_ROW_SELECT)
    .single();
  if (error) throw error;

  const precedentId = String(data.id);
  try {
    await insertPrecedentChunkRows(supabase, precedentId, courtId, chunks, vectors);
  } catch (chunkErr: any) {
    await supabase.from('precedents').delete().eq('id', precedentId);
    const msg = String(chunkErr?.message || chunkErr || '');
    throw new Error(
      msg.includes('precedent_chunks') || msg.includes('match_precedent_chunks') || msg.includes('does not exist')
        ? 'Índice de fragmentos no disponible. Aplique la migración 20260515140000_precedent_chunks en Supabase y reintente.'
        : msg || 'Error al guardar fragmentos vectoriales del precedente.'
    );
  }

  return data;
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
};

const PRECEDENT_SHORT_EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    radicado: { type: 'string' },
    source_corporation: { type: 'string' },
    right_protected: { type: 'string' },
    ruling_sense: { type: 'string' },
    decision_date: { type: 'string' },
    defendant: { type: 'string' },
  },
  required: [
    'radicado',
    'source_corporation',
    'right_protected',
    'ruling_sense',
    'decision_date',
    'defendant',
  ],
} as const;

type PrecedentShortExtract = {
  radicado: string;
  source_corporation: string;
  right_protected: string;
  ruling_sense: string;
  decision_date: string;
  defendant: string;
};

async function extractPrecedentWithOpenAiPdf(openai: OpenAI, pdfBase64: string): Promise<PrecedentExtract> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const promptLargo = `Eres secretario judicial en Colombia. Lee el PDF adjunto (sentencia, auto, providencia o fallo de tutela u otro acto judicial).
Tu salida debe ser ÚNICAMENTE prosa continua en español: sin títulos, sin viñetas, sin numeraciones, sin JSON, sin markdown.
Redacta un solo texto corrido que integre de forma natural: hechos relevantes del caso; derechos fundamentales invocados o analizados; posición del accionado y de las partes frente al conflicto; ratio decidendi; regla o criterio jurídico aplicado; sentido del fallo y las razones del tribunal.
El texto debe tener al menos 2500 caracteres. Si el documento tiene consideraciones jurídicas extensas, incorpóralas con fidelidad (no omitas pasajes sustanciales). No inventes hechos ajenos al acto.`;

  const resLargo = await openai.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: promptLargo },
          {
            type: 'input_file',
            filename: 'sentencia.pdf',
            file_data: `data:application/pdf;base64,${pdfBase64}`,
          },
        ],
      },
    ],
  });

  let textoExtraido = String(resLargo.output_text || '').trim();
  textoExtraido = textoExtraido.replace(/^```[\w]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  const textoParaContexto =
    textoExtraido.length > 100_000 ? textoExtraido.slice(0, 100_000) : textoExtraido;

  const promptCortos = `Eres secretario judicial en Colombia. A partir del siguiente texto ya extraído de un fallo (prosa continua), completa el JSON indicado con datos breves y precisos. Si algo no consta en el texto, usa cadena vacía salvo defendant donde puede usarse "—".

Texto extraído del fallo:
---
${textoParaContexto}
---

Campos del JSON:
- radicado: número o referencia del proceso si aparece (ej. 11001-03-24-000-12345-00, T-760/08).
- source_corporation: juzgado, tribunal o corte que emitió el acto.
- right_protected: materia o derecho(s) tutelado(s) en una frase breve.
- ruling_sense: sentido del fallo en una línea (concede, niega, inadmite, etc.).
- decision_date: AAAA-MM-DD si se deduce con claridad; si no, cadena vacía.
- defendant: accionado o entidad principal; si no aplica, "—".`;

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
    summary: '',
    legal_arguments: `${textoExtraido}\n\n${metaLine}`,
    decision_date,
    defendant,
  };
}

async function extractPrecedentWithOpenAiPlainText(openai: OpenAI, plainText: string): Promise<PrecedentExtract> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const slice = plainText.length > 100_000 ? plainText.slice(0, 100_000) : plainText;
  const prompt = `Eres secretario judicial en Colombia. El siguiente texto fue extraído de un documento Word (.docx) judicial.
Extrae los mismos campos que si fuera un PDF de sentencia. Responde SOLO con el JSON indicado.

Campos:
- radicado, source_corporation, right_protected, ruling_sense, decision_date (AAAA-MM-DD o vacío), defendant (o "—") según las mismas reglas que para PDF.
- summary: opcional, una sola frase de titular o cadena vacía; el texto largo para embedding va en legal_arguments.
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
  return JSON.parse(content) as PrecedentExtract;
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
    const courtId = String(body.courtId || '').trim();
    const sourceTypeRaw = String(body.sourceType || 'jurisprudencia').trim().toLowerCase();
    const sourceType: PrecedentSourceType = sourceTypeRaw === 'despacho' ? 'despacho' : 'jurisprudencia';
    const sourceCorporationFallback = String(body.sourceCorporation || '').trim();
    const radicadoHint = String(body.radicadoHint || '').trim();

    if (!courtId) {
      return res.status(400).json({ error: 'courtId es requerido' });
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

    let sourceCorporation: string | null = null;
    if (sourceType === 'jurisprudencia') {
      sourceCorporation =
        String(extracted.source_corporation || '').trim() || sourceCorporationFallback || null;
      if (!sourceCorporation) {
        return res.status(422).json({
          error:
            'No se identificó la corporación en el documento. Elija «Corporación (respaldo)» en el formulario o use un archivo con encabezado claro.',
        });
      }
    }

    let defendantOut = String(extracted.defendant || '').trim();
    if (!defendantOut) defendantOut = '—';

    const rightProtected = String(extracted.right_protected || '').trim() || 'Materia no determinada';
    const rulingSense = String(extracted.ruling_sense || '').trim() || 'Sentido no determinado';
    const summary = String(extracted.summary || '').trim() || 'Sin resumen automático.';
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

    const supabase = getSupabaseAdmin();
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
      logIndexFromFileDebug: true,
    });
    if (isPdf) {
      await persistPrecedentPdfAfterIndex(supabase, courtId, String(data.id), Buffer.from(file.buffer));
      const { data: refreshed } = await supabase
        .from('precedents')
        .select(PRECEDENT_ROW_SELECT)
        .eq('id', data.id)
        .single();
      return res.json({ precedent: refreshed ?? data, extracted, warnings });
    }
    return res.json({ precedent: data, extracted, warnings });
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

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      outlookApiBuild: '2026-05-19-classify-light-v1',
    });
  });

  registerOutlookRoutes(app, getSupabaseAdmin);
  registerSgdeRoutes(app, getSupabaseAdmin);

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

  app.get('/api/parse-session/:sessionId/attachment/:index', (req, res) => {
    sweepParseSessions();
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

  // Handle EML/MSG upload and parsing
  app.post('/api/parse-email', upload.single('email'), async (req, res) => {
    console.log('Received request for /api/parse-email');
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

      const result = await parseJudicialEmailFromBuffer(multerReq.file.buffer);
      const text = typeof result.text === 'string' ? result.text : '';
      const html = typeof result.html === 'string' ? result.html : '';
      let pdfDigest = '';
      const session = getParseSession(result.parseSessionId);
      if (session?.attachments?.length) {
        try {
          pdfDigest = await digestPdfAttachmentsForSegundaInstancia(session.attachments);
        } catch (pdfDigErr) {
          console.warn('digest PDF segunda instancia:', pdfDigErr);
        }
      }
      let segundaInstancia;
      try {
        segundaInstancia = parseSegundaInstanciaFromEmail(
          String(result.subject || ''),
          `${text}\n${pdfDigest}`,
          html
        );
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
      res.json({ ...result, segundaInstancia });
    } catch (error) {
      console.error('Email parsing error:', error);
      res.status(500).json({ error: 'Failed to parse email' });
    }
  });

  app.post('/api/ai/summarize', async (req, res) => {
    try {
      const { claim, rawText, contextBlock } = req.body || {};
      if (!rawText) {
        return res.status(400).json({ error: 'rawText es requerido' });
      }

      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const openai = getOpenAiClient();
      const ctx =
        typeof contextBlock === 'string' && contextBlock.trim().length > 0
          ? `\n### Datos del expediente en el sistema (plazos, piezas, asignación)\n${contextBlock.trim()}\n`
          : '';

      const prompt = `
Eres un asistente juridico especializado en derecho constitucional colombiano.
Tu tarea es sintetizar los puntos clave de una demanda de tutela por urgencia y el estado procesal útil para el despacho.

REMITENTE/ACCIONANTE: ${claim || 'No especificado'}
${ctx}
CUERPO DEL CORREO/DEMANDA (texto principal):
${rawText}

FORMATO DE SALIDA (USAR MARKDOWN):
### Sintesis Operativa
**1. Derechos presuntamente vulnerados:** (Lista breve)
**2. Hechos relevantes:** (Maximo 3 puntos clave)
**3. Pretension principal:** (Sintesis de lo pedido)
**4. Urgencia detectada:** (Por que es urgente o si hay riesgo de dano irremediable)
**5. Plazos, traslados y contestaciones:** (A partir del bloque de expediente y del texto: términos para el accionado, traslados, respuestas de la EPS u otros; si no consta indique «No consta en los datos suministrados»)
**6. Piezas y seguimiento:** (Relacione brevemente las piezas listadas con la controversia, si aplica)
`;

      const result = await openai.responses.create({
        model,
        input: prompt,
      });

      return res.json({ text: result.output_text || '' });
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
      const out = await analyzeCaseDocumentPiece({
        admin: acc.admin,
        openai,
        userId: uid,
        userName: String(userName),
        caseId,
        caseDocumentId,
        forceRefresh,
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

  app.post('/api/ai/legal-analysis', async (req, res) => {
    try {
      const { prompt, pdfBase64 } = req.body || {};
      if (!prompt || !pdfBase64) {
        return res.status(400).json({ error: 'prompt y pdfBase64 son requeridos' });
      }

      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const openai = getOpenAiClient();
      const parteTutela = {
        type: 'object',
        additionalProperties: false,
        properties: {
          nombre: { type: 'string' },
          identificacion: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['nombre', 'identificacion', 'email'],
      } as const;
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          accionantes: { type: 'array', items: parteTutela, minItems: 1 },
          accionados: { type: 'array', items: parteTutela, minItems: 1 },
          derechoTutelado: { type: 'string' },
          hechos: { type: 'string' },
          pretensiones: { type: 'string' },
        },
        required: ['accionantes', 'accionados', 'derechoTutelado', 'hechos', 'pretensiones'],
      };

      const lengthHint = `
Instrucciones obligatorias para los campos de texto:
- "hechos": párrafo narrativo extenso (mínimo 900 caracteres si el documento lo permite), con cronología y contexto procesal; no menos de 10 frases; tercera persona; no transcribir.
- "pretensiones": síntesis en tercera persona (4 a 6 frases); resume órdenes y plazos sin copiar el escrito ni usar primera persona ni comillas.
`;
      const result = await openai.responses.create({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: `${String(prompt).trim()}\n${lengthHint}` },
              {
                type: 'input_file',
                filename: 'documento.pdf',
                file_data: `data:application/pdf;base64,${pdfBase64}`
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'analisis_tutela',
            schema,
            strict: true
          }
        }
      });

      const content = result.output_text || '{}';
      return res.json({ text: content });
    } catch (error: any) {
      console.error('OpenAI legal-analysis error:', error);
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
      const sourceTypeRaw = String(b.sourceType || 'despacho').trim().toLowerCase();
      const sourceType = sourceTypeRaw === 'jurisprudencia' ? 'jurisprudencia' : 'despacho';
      const sourceCorporation =
        sourceType === 'jurisprudencia' ? String(b.sourceCorporation || '').trim() || null : null;

      if (!courtId || !radicado) {
        return res.status(400).json({ error: 'courtId y radicado son requeridos' });
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

      const openai = getOpenAiClient();
      const embedding = await createEmbedding1536(openai, queryText);
      const embStr = vectorToPgString(embedding);
      const supabase = getSupabaseAdmin();

      const { data: chunkRows, error: chunkErr } = await supabase.rpc('match_precedent_chunks', {
        query_embedding: embStr,
        match_court_id: courtId,
        match_count: 48,
        match_threshold: 0.22,
      });

      if (!chunkErr && Array.isArray(chunkRows) && chunkRows.length > 0) {
        const aggregated = aggregateChunkMatches(chunkRows as MatchPrecedentChunkRow[], 3);
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
        match_count: 3,
        match_threshold: 0.3,
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

      const allowed = ['radicado', 'ruling_sense', 'decision_date'] as const;
      const extra = Object.keys(b).filter((k) => !allowed.includes(k as (typeof allowed)[number]));
      if (extra.length) {
        return res.status(400).json({ error: `Campos no permitidos: ${extra.join(', ')}` });
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Nada que actualizar' });
      }

      // No re-embeddear ni re-chunkear: el vector y precedent_chunks conservan el texto indexado original.
      const { data, error } = await acc.admin
        .from('precedents')
        .update(patch)
        .eq('id', precedentId)
        .select(PRECEDENT_ROW_SELECT)
        .single();
      if (error) throw error;
      return res.json({ precedent: data });
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
  plantillaDocxRouter.post('/analizar', upload.single('archivo'), async (req, res) => {
    try {
      const multerReq = req as Express.Request & { file?: UploadedDocx };
      const file = multerReq.file;
      const tipoRaw = String((req.body as { tipo?: string })?.tipo ?? 'libre');
      const tipo: DocumentTemplateTipo =
        tipoRaw === 'informe_ingreso' || tipoRaw === 'auto_admisorio' || tipoRaw === 'libre' ? tipoRaw : 'libre';
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
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      details: err.stack
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
