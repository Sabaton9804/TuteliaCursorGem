import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import fs from 'fs';
import multer from 'multer';
import { simpleParser } from 'mailparser';
import JSZip from 'jszip';
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
import {
  ACTA_REPARTO_DISPLAY_NAME,
  detectActaRepartoInPdfBuffer,
  filenameSuggestsActaReparto,
} from './pdf-acta-detect';
import { createPrecedentsFileRouter } from './precedents-routes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** Directorio donde está `server.ts` (raíz del código) */
const projectRoot = path.resolve(__dirname);

function stripUtf8Bom(content: string) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function envValueIsUnset(v: string | undefined) {
  return v === undefined || String(v).trim() === '';
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

  for (const [key, val] of Object.entries(merged)) {
    if (val !== '' && envValueIsUnset(process.env[key])) {
      process.env[key] = val;
    }
  }

  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  console.log(
    `[tutelia] OPENAI_API_KEY: ${hasOpenAi ? 'OK' : 'NO'}. ` +
      `Raíz server: ${projectRoot}. cwd: ${cwd}. ` +
      `Archivos leídos: ${loadedFrom.length ? loadedFrom.join(' | ') : '(ninguno)'}`
  );
}

loadProjectEnv();

const PORT = 3000;
const BODY_LIMIT = '100mb';

/** Adjuntos del último parse-email: binarios en servidor; el cliente pide cada uno por GET. */
type ParseSessionRow = {
  sessionIndex: number;
  filename: string;
  originalName?: string;
  contentType: string;
  size: number;
  isFromLink?: boolean;
  order?: number;
  buffer: Buffer;
};

type ParseSession = {
  createdAt: number;
  attachments: ParseSessionRow[];
};

const parseSessions = new Map<string, ParseSession>();
const PARSE_SESSION_TTL_MS = 60 * 60 * 1000;

function sweepParseSessions() {
  const now = Date.now();
  for (const [id, s] of parseSessions) {
    if (now - s.createdAt > PARSE_SESSION_TTL_MS) parseSessions.delete(id);
  }
}

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Falta OPENAI_API_KEY. Cree .env o .env.local en la raíz del proyecto (junto a server.ts) o en la carpeta desde la que ejecuta npm run dev. Reinicie el servidor tras guardar. Revise la consola del terminal al arrancar: línea [tutelia] OPENAI_API_KEY.'
    );
  }
  return new OpenAI({ apiKey });
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

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

async function createEmbedding1536(openai: OpenAI, input: string): Promise<number[]> {
  const trimmed = input.trim().slice(0, 8000);
  if (!trimmed) {
    throw new Error('El texto para embedding está vacío.');
  }
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed,
    dimensions: EMBEDDING_DIM,
  });
  const vec = res.data[0]?.embedding;
  if (!vec?.length || vec.length !== EMBEDDING_DIM) {
    throw new Error('Respuesta de embedding inválida o dimensión distinta de 1536.');
  }
  return vec;
}

function vectorToPgString(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

type PrecedentSourceType = 'despacho' | 'jurisprudencia';

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
  const idxText = [rightProtected, legalArguments, summary].filter(Boolean).join(' ');
  const embedding = await createEmbedding1536(openai, idxText);
  if (logIndexFromFileDebug) {
    console.log(
      '[precedents/index-from-file] embedding OpenAI: vector recibido, dimensión=',
      embedding.length,
      '(esperado 1536)'
    );
  }
  const embStr = vectorToPgString(embedding);
  if (logIndexFromFileDebug) {
    console.log(
      '[precedents/index-from-file] insert precedents: incluye campo embedding=',
      true,
      'longitud string pgvector:',
      embStr.length
    );
  }
  if (caseId) {
    const { error: delErr } = await supabase
      .from('precedents')
      .delete()
      .eq('court_id', courtId)
      .eq('source_case_id', caseId);
    if (delErr) throw delErr;
  }
  const { data, error } = await supabase
    .from('precedents')
    .insert({
      court_id: courtId,
      source_case_id: caseId || null,
      source_type: sourceType,
      source_corporation: sourceCorporation,
      radicado,
      right_protected: rightProtected,
      defendant,
      ruling_sense: rulingSense,
      legal_arguments: legalArguments,
      summary,
      decision_date: decisionDate,
      tags,
      embedding: embStr,
    })
    .select(
      'id, court_id, source_case_id, source_type, source_corporation, radicado, right_protected, defendant, ruling_sense, legal_arguments, summary, decision_date, tags, created_at, updated_at'
    )
    .single();
  if (error) throw error;
  return data;
}

function parseDecisionDateYmd(raw: string): string | null {
  const t = String(raw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : t;
}

function fallbackRadicadoFromFilename(originalname: string | undefined): string {
  const name = (originalname || 'documento').replace(/\.[^/.]+$/i, '');
  const compact = name.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 40);
  if (compact.length >= 4) return compact;
  return `DOC${Date.now()}`;
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

  const promptCortos = `Eres secretario judicial en Colombia. A partir del siguiente texto ya extraído de un fallo (prosa continua), completa el JSON indicado con datos breves y precisos. Si algo no consta en el texto, usa cadena vacía salvo defendant donde puede usarse "—".

Texto extraído del fallo:
---
${textoExtraido}
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

    const radicado =
      String(extracted.radicado || '').trim() ||
      radicadoHint ||
      fallbackRadicadoFromFilename(file.originalname);

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
    return res.json({ precedent: data, extracted });
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
    res.json({ status: 'ok' });
  });

  app.get('/api/parse-session/:sessionId/attachment/:index', (req, res) => {
    sweepParseSessions();
    const sessionId = String(req.params.sessionId || '');
    const i = parseInt(String(req.params.index), 10);
    if (!sessionId || Number.isNaN(i) || i < 0) {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }
    const session = parseSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        error: 'Sesión de parseo expirada o inexistente. Vuelva a cargar el archivo .eml.',
      });
    }
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

      const parsed = await simpleParser(multerReq.file.buffer);
      
      let processedAttachments: any[] = [];
      let globalOrderIndex = 0;
      const nameCounters: Record<string, number> = {};

      const getUniqueName = (baseName: string) => {
        let finalName = baseName;
        if (nameCounters[baseName]) {
          nameCounters[baseName]++;
          finalName = `${baseName} (${nameCounters[baseName]})`;
        } else {
          nameCounters[baseName] = 1;
        }
        return finalName;
      };

      const getPriority = (name: string) => {
        const lower = name.toLowerCase();
        if (lower.includes('actareparto')) return 1;
        if (lower.includes('escritodemanda')) return 2;
        if (lower.includes('poder')) return 3;
        if (lower.includes('documentospruebasanexos')) return 4;
        return 5;
      };

      // 1. Detect and process the "Archivo" download link from the body
      const htmlBody = parsed.html || '';
      const textBody = parsed.text || '';
      
      // Look for a link containing the text "Archivo" in HTML
      let linkMatch = htmlBody.match(/<a\s+[^>]*?href=(["'])(.*?)\1[^>]*?>\s*(?:Descargar\s+)?Archivo\s*<\/a>/i);
      
      let downloadUrl = linkMatch ? linkMatch[2] : null;

      // Fallback: Look for "Archivo: http..." in text body
      if (!downloadUrl) {
        const textMatch = textBody.match(/Archivo:\s*(https?:\/\/[^\s]+)/i);
        if (textMatch) {
          downloadUrl = textMatch[1];
        }
      }
      
      let linkFound = false;
      if (downloadUrl) {
        linkFound = true;
        try {
          console.log(`Attempting to download from: ${downloadUrl}`);
          const response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxRedirects: 15,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Accept: 'application/pdf,application/zip,*/*;q=0.8',
            },
            validateStatus: (status) => status < 500,
          });

          if (response.status >= 400) {
            console.error(`Download failed with status ${response.status}`);
          } else {
            const buffer = Buffer.from(response.data);
            let contentType = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();

            const isPdfMagic =
              buffer.length >= 5 &&
              buffer[0] === 0x25 &&
              buffer[1] === 0x50 &&
              buffer[2] === 0x44 &&
              buffer[3] === 0x46 &&
              buffer[4] === 0x2d;

            // Check if it's a ZIP by content type, URL or signature
            const isZip = contentType === 'application/zip' || 
                          downloadUrl.toLowerCase().split('?')[0].endsWith('.zip') ||
                          (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B);

            if (isZip) {
              const zip = new JSZip();
              const zipContent = await zip.loadAsync(buffer);
              
              // Collect files in order
              const filePromises: any[] = [];
              zip.forEach((relativePath, file) => {
                if (file.dir) return;
                filePromises.push((async () => {
                  const filename = relativePath;
                  const lowerName = filename.toLowerCase();
                  let innerContentType = 'application/octet-stream';
                  if (lowerName.endsWith('.pdf')) innerContentType = 'application/pdf';
                  else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) innerContentType = 'image/jpeg';
                  else if (lowerName.endsWith('.png')) innerContentType = 'image/png';

                  let baseName = filename;
                  if (lowerName.includes('demanda')) baseName = 'EscritoDemanda';
                  else if (lowerName.includes('prueba') || lowerName.includes('anexo')) baseName = 'DocumentosPruebasAnexos';
                  else if (lowerName.includes('poder')) baseName = 'Poder';
                  else if (filenameSuggestsActaReparto(lowerName)) baseName = 'ActaReparto';

                  let originalNameOut = filename;
                  let contentB64: string;
                  if (innerContentType === 'application/pdf') {
                    const pdfBuf = Buffer.from(await file.async('nodebuffer'));
                    if (baseName === filename && (await detectActaRepartoInPdfBuffer(pdfBuf))) {
                      baseName = 'ActaReparto';
                      originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
                    }
                    contentB64 = pdfBuf.toString('base64');
                  } else {
                    contentB64 = await file.async('base64');
                  }

                  return {
                    filename: baseName,
                    originalName: baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : originalNameOut,
                    size: (file as any)._data?.uncompressedSize || 0,
                    contentType: innerContentType,
                    content: contentB64,
                    isFromLink: true,
                    tempOrder: globalOrderIndex++
                  };
                })());
              });
              
              const unzipFiles = await Promise.all(filePromises);
              processedAttachments = [...processedAttachments, ...unzipFiles];
            } else {
              // Single file downloaded
              let baseName = 'DocumentosPruebasAnexos';
              const lowerUrl = downloadUrl.toLowerCase();
              if (filenameSuggestsActaReparto(lowerUrl)) {
                baseName = 'ActaReparto';
              } else if (lowerUrl.includes('demanda')) {
                baseName = 'EscritoDemanda';
              }

              if (!isZip && !isPdfMagic) {
                const probe = buffer
                  .subarray(0, Math.min(800, buffer.length))
                  .toString('utf8')
                  .trimStart()
                  .toLowerCase();
                if (
                  probe.startsWith('<!doctype') ||
                  probe.startsWith('<html') ||
                  probe.startsWith('<?xml')
                ) {
                  contentType = 'text/html';
                } else if (contentType === 'application/pdf' || contentType === 'application/octet-stream') {
                  contentType = 'application/octet-stream';
                }
              } else if (isPdfMagic) {
                contentType = 'application/pdf';
              }

              let originalLinkName =
                baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : 'archivo_descargado';
              if (
                isPdfMagic &&
                baseName !== 'ActaReparto' &&
                (await detectActaRepartoInPdfBuffer(buffer))
              ) {
                baseName = 'ActaReparto';
                originalLinkName = ACTA_REPARTO_DISPLAY_NAME;
              }

              processedAttachments.push({
                filename: baseName,
                originalName: originalLinkName,
                size: buffer.length,
                contentType: contentType,
                content: buffer.toString('base64'),
                isFromLink: true,
                tempOrder: globalOrderIndex++
              });
            }
          }
        } catch (downloadError) {
          console.error(`Error downloading file from "Archivo" link:`, downloadError);
        }
      }

      // 2. Process physical attachments (filtering out images as they are in the PDF already)
      const validAttachments = (parsed.attachments || []).filter(att => {
        if (att.contentType?.startsWith('image/')) return false;
        return true;
      });
      
      for (const att of validAttachments) {
        const lowerOrig = (att.filename || "").toLowerCase();
        let contentType = att.contentType || 'application/octet-stream';
        
        if (lowerOrig.endsWith('.pdf')) contentType = 'application/pdf';
        
        if (contentType === 'application/zip' || att.filename?.endsWith('.zip')) {
          const zip = new JSZip();
          const zipContent = await zip.loadAsync(att.content);
          
          const filePromises: any[] = [];
          zip.forEach((relativePath, file) => {
            if (file.dir) return;
            filePromises.push((async () => {
              const filename = relativePath;
              const lowerName = filename.toLowerCase();
              let innerContentType = 'application/octet-stream';
              if (lowerName.endsWith('.pdf')) innerContentType = 'application/pdf';

              let baseName = filename;
              if (lowerName.includes('demanda')) baseName = 'EscritoDemanda';
              else if (lowerName.includes('prueba') || lowerName.includes('anexo')) baseName = 'DocumentosPruebasAnexos';
              else if (lowerName.includes('poder')) baseName = 'Poder';
              else if (filenameSuggestsActaReparto(lowerName)) baseName = 'ActaReparto';

              let originalNameZip = filename;
              let contentB64Zip: string;
              if (innerContentType === 'application/pdf') {
                const pdfBuf = Buffer.from(await file.async('nodebuffer'));
                if (baseName === filename && (await detectActaRepartoInPdfBuffer(pdfBuf))) {
                  baseName = 'ActaReparto';
                  originalNameZip = ACTA_REPARTO_DISPLAY_NAME;
                }
                contentB64Zip = pdfBuf.toString('base64');
              } else {
                contentB64Zip = await file.async('base64');
              }

              return {
                filename: baseName,
                originalName: baseName === 'ActaReparto' ? ACTA_REPARTO_DISPLAY_NAME : originalNameZip,
                size: (file as any)._data?.uncompressedSize || 0,
                contentType: innerContentType,
                content: contentB64Zip,
                tempOrder: globalOrderIndex++
              };
            })());
          });

          const unzipFiles = await Promise.all(filePromises);
          processedAttachments = [...processedAttachments, ...unzipFiles];
        } else {
          // Individual file processing
          let baseName = att.filename || 'Documento';
          let originalNameOut = att.filename || 'Documento';
          if (filenameSuggestsActaReparto(lowerOrig)) baseName = 'ActaReparto';
          else if (lowerOrig.includes('poder')) baseName = 'Poder';
          else if (lowerOrig.includes('demanda')) baseName = 'EscritoDemanda';
          else if (lowerOrig.includes('prueba') || lowerOrig.includes('anexo')) baseName = 'DocumentosPruebasAnexos';

          if (
            contentType === 'application/pdf' &&
            att.content &&
            baseName === (att.filename || 'Documento')
          ) {
            const pdfBuf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
            if (await detectActaRepartoInPdfBuffer(pdfBuf)) {
              baseName = 'ActaReparto';
              originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
            }
          }
          if (baseName === 'ActaReparto') {
            originalNameOut = ACTA_REPARTO_DISPLAY_NAME;
          }

          processedAttachments.push({
            filename: baseName,
            originalName: originalNameOut,
            size: att.size,
            contentType: contentType,
            content: att.content ? att.content.toString('base64') : '',
            tempOrder: globalOrderIndex++
          });
        }
      }

      // Final Sorting and Unique Naming
      processedAttachments.sort((a, b) => {
        const pA = getPriority(a.filename);
        const pB = getPriority(b.filename);
        if (pA !== pB) return pA - pB;
        return a.tempOrder - b.tempOrder;
      });

      // Reset counters and assign unique names + final order
      const finalProcessed = processedAttachments.map((att, idx) => {
        const uniqueName = getUniqueName(att.filename);
        return {
          ...att,
          filename: uniqueName,
          // Tras desempates (p. ej. dos «EscritoDemanda»), solo cambiaba `filename`;
          // alinear `originalName` evita que radicación/visor sigan mostrando el MIME antiguo.
          originalName: uniqueName,
          order: idx
        };
      });

      sweepParseSessions();
      const parseSessionId = randomUUID();
      const sessionAttachments: ParseSessionRow[] = finalProcessed.map((att: any, idx: number) => {
        const buf = Buffer.from(att.content || '', 'base64');
        return {
          sessionIndex: idx,
          filename: att.filename,
          originalName: att.originalName,
          contentType: att.contentType || 'application/octet-stream',
          size: typeof att.size === 'number' ? att.size : buf.length,
          isFromLink: !!att.isFromLink,
          order: att.order,
          buffer: buf,
        };
      });
      parseSessions.set(parseSessionId, {
        createdAt: Date.now(),
        attachments: sessionAttachments,
      });

      const publicAttachments = sessionAttachments.map(({ buffer: _buf, ...meta }) => meta);

      res.json({
        subject: parsed.subject,
        from: parsed.from?.text,
        to: parsed.to ? (Array.isArray(parsed.to) ? (parsed.to[0] as any).text : (parsed.to as any).text) : '',
        date: parsed.date,
        text: parsed.text,
        html: parsed.html,
        attachments: publicAttachments,
        parseSessionId,
        linkFound: linkFound,
        linkUrl: downloadUrl
      });
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

      const result = await openai.responses.create({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
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

  app.use('/api/precedents', createPrecedentsFileRouter(upload, handlePrecedentsIndexFromFile));

  app.post('/api/precedents/index', async (req, res) => {
    try {
      const b = req.body || {};
      const caseId = String(b.caseId || '').trim();
      const courtId = String(b.courtId || '').trim();
      const radicado = String(b.radicado || '').trim();
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
      const preLimit = 50;
      const { data: preThresholdRows, error: preErr } = await supabase.rpc('match_precedents', {
        query_embedding: embStr,
        match_court_id: courtId,
        match_count: preLimit,
        match_threshold: -1,
      });
      if (preErr) {
        console.warn('[precedents/search] no se pudo contar candidatos sin umbral:', preErr.message);
      } else {
        const n = Array.isArray(preThresholdRows) ? preThresholdRows.length : 0;
        console.log(
          '[precedents/search] match_precedents antes del umbral (mismo orden; threshold=-1, limit',
          preLimit,
          '):',
          n,
          'filas'
        );
      }
      const { data, error } = await supabase.rpc('match_precedents', {
        query_embedding: embStr,
        match_court_id: courtId,
        match_count: 3,
        match_threshold: 0.3,
      });
      if (error) throw error;
      return res.json({ results: data ?? [] });
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
