import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import { countPdfPagesInBuffer, extractPlainTextFromPdfBuffer } from '../pdf-acta-detect.ts';
import { extraerTextoPlanoDocx } from '../docx-plantilla-server';
import { downloadCaseDocumentFromSgde } from './sgde-repair-storage.js';
import type { SgdeClient } from './sgde-client.js';
import {
  PIECE_AI_PROMPT_VERSION,
  buildPieceAiSummaryMarkdown,
  isCivilCaseForPieceAi,
  isLikelyCivilCgpAutoPiece,
  type PieceAiAnalysisData,
  type PieceAiCgpAutoAnalysisData,
  type PieceAiGeneralAnalysisData,
} from '../src/lib/piece-ai-analysis.ts';
import { parseCatalogMetadata } from '../src/lib/case-catalog-metadata.ts';

const CASE_DOCUMENTS_BUCKET = 'case-documents';
const DEFAULT_MAX_PAGES = 40;
const MAX_DOCX_CHARS = 100_000;

export function pieceAiMaxPages(): number {
  const raw = Number(process.env.AI_PIECE_MAX_PAGES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_PAGES;
}

function pieceAiModel(): string {
  return (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function isPdfContentType(ct: string, name: string): boolean {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return true;
  return ct.includes('pdf');
}

function isDocxContentType(ct: string, name: string): boolean {
  const n = name.toLowerCase();
  if (n.endsWith('.docx') || n.endsWith('.doc')) return true;
  return (
    ct.includes('wordprocessingml') ||
    ct.includes('application/msword') ||
    ct.includes('officedocument.wordprocessingml')
  );
}

async function downloadCaseDocumentBytes(
  admin: SupabaseClient,
  storagePath: string
): Promise<Buffer> {
  const path = storagePath.trim();
  const { data, error } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
  if (error || !data) {
    throw new Error(error?.message || 'No se pudo descargar la pieza desde Storage.');
  }
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

const PIECE_ANALYSIS_GENERAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema: { type: 'string', enum: ['general_v1'] },
    document_type: { type: 'string' },
    purpose: { type: 'string' },
    critical_dates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['date', 'description'],
      },
    },
    key_points: {
      type: 'array',
      items: { type: 'string' },
    },
    utility_note: { type: 'string' },
  },
  required: ['schema', 'document_type', 'purpose', 'critical_dates', 'key_points', 'utility_note'],
} as const;

const PIECE_ANALYSIS_CGP_AUTO_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema: { type: 'string', enum: ['cgp_auto_v2'] },
    document_type: { type: 'string' },
    resolutive_summary: { type: 'string' },
    legal_grounds: {
      type: 'array',
      items: { type: 'string' },
    },
    business_term: {
      type: 'object',
      additionalProperties: false,
      properties: {
        applies: { type: 'boolean' },
        days: { type: 'integer' },
        count_from: { type: 'string' },
        legal_basis: { type: 'string' },
        deadline_hint: { type: 'string' },
        stage_note: { type: 'string' },
      },
      required: ['applies', 'days', 'count_from', 'legal_basis', 'deadline_hint', 'stage_note'],
    },
    planner_due: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        due_note: { type: 'string' },
        responsible: { type: 'string' },
        priority: { type: 'string' },
      },
      required: ['title', 'due_note', 'responsible', 'priority'],
    },
    subsequent_actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          order: { type: 'integer' },
          action: { type: 'string' },
          responsible: { type: 'string' },
        },
        required: ['order', 'action', 'responsible'],
      },
    },
    informe_j51_draft: { type: 'string' },
    cautions: {
      type: 'array',
      items: { type: 'string' },
    },
    ocr_quality_note: { type: 'string' },
  },
  required: [
    'schema',
    'document_type',
    'resolutive_summary',
    'legal_grounds',
    'business_term',
    'planner_due',
    'subsequent_actions',
    'informe_j51_draft',
    'cautions',
    'ocr_quality_note',
  ],
} as const;

type PieceAiPromptMode = 'general_v1' | 'cgp_auto_v2';

function buildPieceAiSystemPrompt(meta: {
  pieceName: string;
  systemType: string;
  notebookCode: string | null;
  radicado: string;
  caseType: string | null;
  tipoProceso: string | null;
  etapa: string | null;
  tramitePendiente: string | null;
  mode: PieceAiPromptMode;
}): string {
  const contextBlock = [
    `- Radicado: ${meta.radicado}`,
    `- Nombre de la pieza: ${meta.pieceName}`,
    `- Tipo técnico en sistema: ${meta.systemType || 'no indicado'}`,
    `- Cuaderno (código): ${meta.notebookCode || 'no indicado'}`,
    meta.caseType ? `- Clasificación caso: ${meta.caseType}` : null,
    meta.tipoProceso ? `- Tipo de proceso: ${meta.tipoProceso}` : null,
    meta.etapa ? `- Etapa (catálogo): ${meta.etapa}` : null,
    meta.tramitePendiente ? `- Trámite pendiente (Planner): ${meta.tramitePendiente}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (meta.mode === 'cgp_auto_v2') {
    return `Eres un asistente de secretaría civil del Juzgado 51 de Circuito (J51), especializado en procesos civiles bajo el Código General del Proceso (CGP), en particular estado civil y familia. Analizas UNA pieza del expediente — normalmente un auto o providencia firmada — para producir una lectura OPERATIVA para la secretaría, no un resumen académico.

Reglas obligatorias:
1. Basa cada campo solo en el texto de la pieza y el contexto mínimo del expediente. No inventes hechos, partes ni fechas.
2. Si el texto es ilegible u OCR defectuoso, dilo en ocr_quality_note y sé conservador en plazos y resolución.
3. No sustituyes la lectura obligatoria ni emites decisión judicial.
4. Tono técnico, directo, en español colombiano.

Cómputo de términos (CGP art. 118):
- Los plazos en días son hábiles salvo que el auto diga expresamente «días calendario».
- El término corre desde el día siguiente a la notificación personal o a la última notificación (si el auto lo ordena así). Si el auto no fija evento de inicio, usa «día siguiente a la notificación del auto» e indícalo en count_from.
- Excluye sábados, domingos, festivos nacionales, Semana Santa (Domingo de Ramos a Domingo de Pascua), 17 de diciembre y vacancia judicial (20 dic – 10 ene).
- Si el último día cae en inhábil, el término vence el siguiente día hábil.
- En deadline_hint: indica días concedidos, evento de inicio y, si consta fecha del auto (YYYY-MM-DD), una fecha tentativa de vencimiento con la fórmula «tentativa: notificación + N días hábiles (art. 118 CGP)». Si no consta fecha de notificación, no calcules fecha exacta.

Plazos frecuentes en autos CGP (aplica solo si el auto lo dice o se infiere con claridad):
- Inadmisión con subsanación (art. 90 CGP): usualmente 5 días hábiles para corregir la demanda.
- Traslado de excepciones previas: 10 días hábiles (art. 100 CGP).
- Contestación de la demanda: 20 días hábiles (art. 371 CGP) desde notificación personal al demandado.
- Recurso de reposición contra autos: 3 días hábiles (art. 318 CGP) desde notificación.

Salida operativa requerida:
- resolutive_summary: qué resolvió el despacho (admite, inadmite, decreta, ordena, niega, etc.) en 2-4 oraciones.
- legal_grounds: artículos y numerales citados (p. ej. «CGP art. 90 num. 3»).
- business_term: plazo perentorio que nace del auto; stage_note = estado procesal inmediato (p. ej. «En espera de subsanación de la demanda»).
- planner_due: UNA tarea prioritaria para Planner/Due con título accionable, vencimiento orientativo y responsable (secretaría, escribiente, despacho).
- subsequent_actions: 3-6 pasos posteriores al auto en orden lógico de secretaría J51 (informe de ingreso, notificación, registro en TYBA/SGDE, vigilancia de término, etc.).
- informe_j51_draft: borrador de texto plano del informe de ingreso al despacho (encabezado «INFORME DE INGRESO AL DESPACHO», párrafo «En la fecha…» con hecho procesal del auto, sin membrete ni firma). Usa [CIUDAD] y [FECHA] si no constan.
- cautions: riesgos operativos (término corto, notificación incompleta, recurso procedente, archivo, etc.).

Contexto del expediente:
${contextBlock}

Responde únicamente con el JSON del esquema cgp_auto_v2.`;
  }

  return `Eres un asistente jurídico experto en derecho procesal constitucional colombiano. Realizas una "lectura rápida asistida" de UNA sola pieza digital del expediente.

Instrucciones críticas:
1. Basa tu respuesta únicamente en el contenido de la pieza proporcionada. No resuelvas el caso completo ni proyectes fallos.
2. Tono neutro, técnico y descriptivo.
3. Si el texto está vacío o parece OCR defectuoso (caracteres sin sentido), indícalo en utility_note.
4. El "tipo" del sistema (${meta.systemType}) es técnico; infiere el tipo jurídico del documento (memorial, poder, dictamen, etc.).

Metadata del expediente (solo contexto, no sustituye la pieza):
${contextBlock}

Extrae:
- schema: siempre "general_v1".
- document_type: tipo jurídico del documento.
- purpose: qué aporta o qué pide esta pieza.
- critical_dates: fechas o plazos explícitos en el documento (date puede ser YYYY-MM-DD o texto literal).
- key_points: 3 a 5 bullets de hechos o argumentos de ESTA pieza.
- utility_note: sugerencia operativa breve para el sustanciador al revisar el papel.`;
}

function normalizeGeneralAnalysis(parsed: Record<string, unknown>): PieceAiGeneralAnalysisData {
  return {
    schema: 'general_v1',
    document_type: String(parsed.document_type || '').trim(),
    purpose: String(parsed.purpose || '').trim(),
    critical_dates: Array.isArray(parsed.critical_dates)
      ? parsed.critical_dates.map((d) => {
          const row = d as Record<string, unknown>;
          return {
            date: String(row?.date || '').trim(),
            description: String(row?.description || '').trim(),
          };
        })
      : [],
    key_points: Array.isArray(parsed.key_points)
      ? parsed.key_points.map((p) => String(p || '').trim()).filter(Boolean)
      : [],
    utility_note: String(parsed.utility_note || '').trim(),
  };
}

function normalizeCgpAutoAnalysis(parsed: Record<string, unknown>): PieceAiCgpAutoAnalysisData {
  const termRaw = (parsed.business_term ?? {}) as Record<string, unknown>;
  const plannerRaw = (parsed.planner_due ?? {}) as Record<string, unknown>;
  return {
    schema: 'cgp_auto_v2',
    document_type: String(parsed.document_type || '').trim(),
    resolutive_summary: String(parsed.resolutive_summary || '').trim(),
    legal_grounds: Array.isArray(parsed.legal_grounds)
      ? parsed.legal_grounds.map((g) => String(g || '').trim()).filter(Boolean)
      : [],
    business_term: {
      applies: Boolean(termRaw.applies),
      days: Number.isFinite(Number(termRaw.days)) ? Math.max(0, Math.floor(Number(termRaw.days))) : 0,
      count_from: String(termRaw.count_from || '').trim(),
      legal_basis: String(termRaw.legal_basis || '').trim(),
      deadline_hint: String(termRaw.deadline_hint || '').trim(),
      stage_note: String(termRaw.stage_note || '').trim(),
    },
    planner_due: {
      title: String(plannerRaw.title || '').trim(),
      due_note: String(plannerRaw.due_note || '').trim(),
      responsible: String(plannerRaw.responsible || 'secretaría').trim(),
      priority: String(plannerRaw.priority || 'media').trim(),
    },
    subsequent_actions: Array.isArray(parsed.subsequent_actions)
      ? parsed.subsequent_actions
          .map((row) => {
            const s = row as Record<string, unknown>;
            return {
              order: Number.isFinite(Number(s?.order)) ? Math.floor(Number(s.order)) : 0,
              action: String(s?.action || '').trim(),
              responsible: String(s?.responsible || 'secretaría').trim(),
            };
          })
          .filter((s) => s.action)
      : [],
    informe_j51_draft: String(parsed.informe_j51_draft || '').trim(),
    cautions: Array.isArray(parsed.cautions)
      ? parsed.cautions.map((c) => String(c || '').trim()).filter(Boolean)
      : [],
    ocr_quality_note: String(parsed.ocr_quality_note || '').trim(),
  };
}

async function callOpenAiPieceAnalysis(
  openai: OpenAI,
  opts: {
    prompt: string;
    mode: PieceAiPromptMode;
    pdfBase64?: string;
    plainText?: string;
  }
): Promise<PieceAiAnalysisData> {
  const model = pieceAiModel();
  const userContent: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_file'; filename: string; file_data: string }
  > = [{ type: 'input_text', text: opts.prompt }];
  if (opts.pdfBase64) {
    userContent.push({
      type: 'input_file',
      filename: 'pieza.pdf',
      file_data: `data:application/pdf;base64,${opts.pdfBase64}`,
    });
  } else if (opts.plainText) {
    userContent.push({
      type: 'input_text',
      text: `\n--- TEXTO DE LA PIEZA ---\n${opts.plainText}`,
    });
  }

  const schema =
    opts.mode === 'cgp_auto_v2'
      ? PIECE_ANALYSIS_CGP_AUTO_JSON_SCHEMA
      : PIECE_ANALYSIS_GENERAL_JSON_SCHEMA;
  const schemaName =
    opts.mode === 'cgp_auto_v2' ? 'lectura_operativa_auto_cgp' : 'lectura_rapida_pieza';

  const result = await openai.responses.create({
    model,
    input: [{ role: 'user', content: userContent }],
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        schema,
        strict: true,
      },
    },
  });

  const raw = result.output_text || '{}';
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (opts.mode === 'cgp_auto_v2') return normalizeCgpAutoAnalysis(parsed);
  return normalizeGeneralAnalysis(parsed);
}

type CaseDocRow = {
  id: string;
  case_id: string;
  name: string;
  type: string;
  content_type: string | null;
  storage_path: string | null;
  content: string | null;
  notebook_code: string | null;
  file_hash: string | null;
  sgde_id: string | null;
};

async function loadCaseDocumentBytes(opts: {
  admin: SupabaseClient;
  caseId: string;
  doc: CaseDocRow;
  sgdeClient: SgdeClient | null;
}): Promise<Buffer> {
  const { admin, caseId, doc, sgdeClient } = opts;
  const storagePath = doc.storage_path?.trim() || '';

  // Mismo origen que el visor: Storage primero; SGDE solo si falta o está vacío.
  if (storagePath) {
    try {
      const storageBuf = await downloadCaseDocumentBytes(admin, storagePath);
      if (storageBuf.length >= 100) return storageBuf;
    } catch {
      /* intentar SGDE */
    }
  }

  if (sgdeClient) {
    const sgdeBuf = await downloadCaseDocumentFromSgde({
      client: sgdeClient,
      admin,
      caseId,
      doc,
    });
    if (sgdeBuf?.length) return sgdeBuf;
  }

  if (storagePath) {
    return downloadCaseDocumentBytes(admin, storagePath);
  }
  if (doc.content?.trim()) {
    try {
      return Buffer.from(doc.content, 'base64');
    } catch {
      throw Object.assign(new Error('Contenido de la pieza no es un archivo válido.'), { status: 400 });
    }
  }

  if (sgdeClient) {
    throw Object.assign(
      new Error(
        'No se pudo leer el PDF desde SGDE. Verifique credenciales en Ajustes e intente de nuevo.'
      ),
      { status: 400 }
    );
  }
  if (doc.sgde_id?.trim()) {
    throw Object.assign(
      new Error(
        'La pieza está vinculada a SGDE pero no hay sesión SGDE. Configure credenciales en Ajustes → Interconexión SGDE.'
      ),
      { status: 400 }
    );
  }
  throw Object.assign(new Error('No hay archivo para analizar.'), { status: 400 });
}

type CacheRow = {
  content_hash: string;
  prompt_version: string;
  model: string;
  analysis_data: PieceAiAnalysisData;
  summary_markdown: string;
  page_count_sent: number;
  created_at: string;
};

export type AnalyzePieceResult = {
  cached: boolean;
  contentHash: string;
  pageCountSent: number;
  analysisData: PieceAiAnalysisData;
  summaryMarkdown: string;
  analyzedAt?: string;
};

export async function analyzeCaseDocumentPiece(opts: {
  admin: SupabaseClient;
  openai: OpenAI;
  userId: string;
  userName: string;
  caseId: string;
  caseDocumentId: string;
  forceRefresh?: boolean;
  sgdeClient?: SgdeClient | null;
  pdfPageCountHint?: number | null;
}): Promise<AnalyzePieceResult> {
  const {
    admin,
    openai,
    userId,
    userName,
    caseId,
    caseDocumentId,
    forceRefresh,
    sgdeClient,
    pdfPageCountHint,
  } = opts;
  const maxPages = pieceAiMaxPages();
  const model = pieceAiModel();

  const { data: docRow, error: docErr } = await admin
    .from('case_documents')
    .select(
      'id, case_id, name, type, content_type, storage_path, content, notebook_code, file_hash, sgde_id'
    )
    .eq('id', caseDocumentId)
    .maybeSingle();

  if (docErr || !docRow?.id) {
    throw Object.assign(new Error('Pieza no encontrada.'), { status: 404 });
  }
  const doc = docRow as CaseDocRow;
  if (doc.case_id !== caseId) {
    throw Object.assign(new Error('La pieza no pertenece a este expediente.'), { status: 400 });
  }

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('radicado, case_type, catalog_metadata')
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    throw Object.assign(new Error('Expediente no encontrado.'), { status: 404 });
  }

  const fileBuf = await loadCaseDocumentBytes({
    admin,
    caseId,
    doc,
    sgdeClient: sgdeClient ?? null,
  });

  const contentHash = sha256Hex(fileBuf);
  const pieceName = String(doc.name || 'Sin nombre');
  const ct = String(doc.content_type || '').toLowerCase();
  const pdf = isPdfContentType(ct, pieceName);
  const docx = isDocxContentType(ct, pieceName);

  if (!pdf && !docx) {
    throw Object.assign(
      new Error('Solo se analizan piezas en PDF o Word (.docx).'),
      { status: 400 }
    );
  }

  if (!forceRefresh) {
    const { data: cached } = await admin
      .from('case_document_ai_analyses')
      .select(
        'content_hash, prompt_version, model, analysis_data, summary_markdown, page_count_sent, created_at'
      )
      .eq('case_document_id', caseDocumentId)
      .maybeSingle();

    const row = cached as CacheRow | null;
    if (
      row &&
      row.content_hash === contentHash &&
      row.prompt_version === PIECE_AI_PROMPT_VERSION &&
      row.model === model
    ) {
      return {
        cached: true,
        contentHash,
        pageCountSent: row.page_count_sent,
        analysisData: row.analysis_data,
        summaryMarkdown: row.summary_markdown,
        analyzedAt: row.created_at,
      };
    }
  }

  const catalogMeta = parseCatalogMetadata(caseRow.catalog_metadata);
  const caseType = caseRow.case_type ? String(caseRow.case_type) : null;
  const civilAutoPiece =
    isCivilCaseForPieceAi(caseType, catalogMeta?.tipo_registro) &&
    isLikelyCivilCgpAutoPiece(pieceName, doc.type);
  const promptMode: PieceAiPromptMode = civilAutoPiece ? 'cgp_auto_v2' : 'general_v1';
  const promptMeta = {
    pieceName,
    systemType: String(doc.type || ''),
    notebookCode: doc.notebook_code ? String(doc.notebook_code) : null,
    radicado: String(caseRow.radicado || ''),
    caseType,
    tipoProceso: catalogMeta?.tipo_proceso ?? null,
    etapa: catalogMeta?.etapa ?? null,
    tramitePendiente: catalogMeta?.tramite_pendiente ?? null,
    mode: promptMode,
  };
  const systemPrompt = buildPieceAiSystemPrompt(promptMeta);

  let pageCountSent = 0;
  let tokenEstimate: number | null = null;
  let analysisData: PieceAiAnalysisData;

  if (pdf) {
    const hinted =
      typeof pdfPageCountHint === 'number' && pdfPageCountHint > 0
        ? Math.floor(pdfPageCountHint)
        : null;
    pageCountSent = (await countPdfPagesInBuffer(fileBuf)) ?? hinted ?? 0;
    if (pageCountSent <= 0) {
      throw Object.assign(
        new Error(
          'No se pudo leer la estructura del PDF para contar páginas. Abra la pieza en el visor y reintente.'
        ),
        { status: 400 }
      );
    }
    if (pageCountSent > maxPages) {
      throw Object.assign(
        new Error(
          `El documento tiene ${pageCountSent} páginas. El máximo para lectura rápida es ${maxPages}. Revise por secciones o consulte la síntesis del expediente.`
        ),
        { status: 400 }
      );
    }
    const pdfBase64 = fileBuf.toString('base64');
    tokenEstimate = Math.ceil(pdfBase64.length / 4);
    try {
      analysisData = await callOpenAiPieceAnalysis(openai, {
        prompt: systemPrompt,
        mode: promptMode,
        pdfBase64,
      });
    } catch (pdfErr) {
      const plain = await extractPlainTextFromPdfBuffer(fileBuf, maxPages);
      const trimmed = plain.trim();
      if (!trimmed) throw pdfErr;
      if (trimmed.length > MAX_DOCX_CHARS) {
        throw Object.assign(
          new Error(
            `El texto extraído del PDF supera ${MAX_DOCX_CHARS.toLocaleString('es-CO')} caracteres. Revise el archivo manualmente.`
          ),
          { status: 400 }
        );
      }
      tokenEstimate = Math.ceil(trimmed.length / 4);
      analysisData = await callOpenAiPieceAnalysis(openai, {
        prompt: systemPrompt,
        mode: promptMode,
        plainText: trimmed,
      });
    }
  } else {
    const text = await extraerTextoPlanoDocx(fileBuf);
    const trimmed = text.trim();
    if (!trimmed) {
      throw Object.assign(
        new Error('No se extrajo texto del Word. Puede estar vacío o protegido.'),
        { status: 400 }
      );
    }
    if (trimmed.length > MAX_DOCX_CHARS) {
      throw Object.assign(
        new Error(
          `El texto extraído supera ${MAX_DOCX_CHARS.toLocaleString('es-CO')} caracteres. Revise el archivo manualmente.`
        ),
        { status: 400 }
      );
    }
    pageCountSent = 0;
    tokenEstimate = Math.ceil(trimmed.length / 4);
    analysisData = await callOpenAiPieceAnalysis(openai, {
      prompt: systemPrompt,
      mode: promptMode,
      plainText: trimmed,
    });
  }

  const summaryMarkdown = buildPieceAiSummaryMarkdown(analysisData);
  const now = new Date().toISOString();

  await admin.from('case_document_ai_analyses').delete().eq('case_document_id', caseDocumentId);

  const { error: insErr } = await admin.from('case_document_ai_analyses').insert({
    case_document_id: caseDocumentId,
    case_id: caseId,
    content_hash: contentHash,
    page_count_sent: pageCountSent,
    token_estimate: tokenEstimate,
    model,
    prompt_version: PIECE_AI_PROMPT_VERSION,
    analysis_data: analysisData,
    summary_markdown: summaryMarkdown,
    created_by: userId,
    created_at: now,
  });
  if (insErr) {
    console.error('case_document_ai_analyses insert:', insErr);
    throw new Error(insErr.message || 'No se pudo guardar el análisis.');
  }

  await admin
    .from('case_documents')
    .update({ file_hash: contentHash })
    .eq('id', caseDocumentId);

  await admin.from('case_actions').insert({
    case_id: caseId,
    type: 'ai_piece_analysis',
    description: `Lectura rápida con IA: ${pieceName}`,
    user_id: userId,
    user_name: userName,
  });

  return {
    cached: false,
    contentHash,
    pageCountSent,
    analysisData,
    summaryMarkdown,
    analyzedAt: now,
  };
}
