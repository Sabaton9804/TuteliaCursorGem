import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import { PDFDocument } from 'pdf-lib';
import { extraerTextoPlanoDocx } from '../docx-plantilla-server';
import {
  PIECE_AI_PROMPT_VERSION,
  buildPieceAiSummaryMarkdown,
  type PieceAiAnalysisData,
} from '../src/lib/piece-ai-analysis.ts';

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

const PIECE_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
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
  required: ['document_type', 'purpose', 'critical_dates', 'key_points', 'utility_note'],
} as const;

function buildPieceAiSystemPrompt(meta: {
  pieceName: string;
  systemType: string;
  notebookCode: string | null;
  radicado: string;
}): string {
  return `Eres un asistente jurídico experto en derecho procesal constitucional colombiano. Realizas una "lectura rápida asistida" de UNA sola pieza digital del expediente.

Instrucciones críticas:
1. Basa tu respuesta únicamente en el contenido de la pieza proporcionada. No resuelvas el caso completo ni proyectes fallos.
2. Tono neutro, técnico y descriptivo.
3. Si el texto está vacío o parece OCR defectuoso (caracteres sin sentido), indícalo en utility_note.
4. El "tipo" del sistema (${meta.systemType}) es técnico; infiere el tipo jurídico del documento (memorial, poder, dictamen, etc.).

Metadata del expediente (solo contexto, no sustituye la pieza):
- Radicado: ${meta.radicado}
- Nombre de la pieza: ${meta.pieceName}
- Cuaderno (código): ${meta.notebookCode || 'no indicado'}

Extrae:
- document_type: tipo jurídico del documento.
- purpose: qué aporta o qué pide esta pieza.
- critical_dates: fechas o plazos explícitos en el documento (date puede ser YYYY-MM-DD o texto literal).
- key_points: 3 a 5 bullets de hechos o argumentos de ESTA pieza.
- utility_note: sugerencia operativa breve para el sustanciador al revisar el papel.`;
}

async function callOpenAiPieceAnalysis(
  openai: OpenAI,
  opts: {
    prompt: string;
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

  const result = await openai.responses.create({
    model,
    input: [{ role: 'user', content: userContent }],
    text: {
      format: {
        type: 'json_schema',
        name: 'lectura_rapida_pieza',
        schema: PIECE_ANALYSIS_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  const raw = result.output_text || '{}';
  const parsed = JSON.parse(raw) as PieceAiAnalysisData;
  return {
    document_type: String(parsed.document_type || '').trim(),
    purpose: String(parsed.purpose || '').trim(),
    critical_dates: Array.isArray(parsed.critical_dates)
      ? parsed.critical_dates.map((d) => ({
          date: String(d?.date || '').trim(),
          description: String(d?.description || '').trim(),
        }))
      : [],
    key_points: Array.isArray(parsed.key_points)
      ? parsed.key_points.map((p) => String(p || '').trim()).filter(Boolean)
      : [],
    utility_note: String(parsed.utility_note || '').trim(),
  };
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
};

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
}): Promise<AnalyzePieceResult> {
  const { admin, openai, userId, userName, caseId, caseDocumentId, forceRefresh } = opts;
  const maxPages = pieceAiMaxPages();
  const model = pieceAiModel();

  const { data: docRow, error: docErr } = await admin
    .from('case_documents')
    .select('id, case_id, name, type, content_type, storage_path, content, notebook_code, file_hash')
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
    .select('radicado')
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    throw Object.assign(new Error('Expediente no encontrado.'), { status: 404 });
  }

  const storagePath = doc.storage_path?.trim() || '';
  let fileBuf: Buffer | null = null;
  if (storagePath) {
    fileBuf = await downloadCaseDocumentBytes(admin, storagePath);
  } else if (doc.content?.trim()) {
    try {
      fileBuf = Buffer.from(doc.content, 'base64');
    } catch {
      throw Object.assign(new Error('Contenido de la pieza no es un archivo válido.'), { status: 400 });
    }
  } else {
    throw Object.assign(new Error('No hay archivo para analizar.'), { status: 400 });
  }

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

  const promptMeta = {
    pieceName,
    systemType: String(doc.type || ''),
    notebookCode: doc.notebook_code ? String(doc.notebook_code) : null,
    radicado: String(caseRow.radicado || ''),
  };
  const systemPrompt = buildPieceAiSystemPrompt(promptMeta);

  let pageCountSent = 0;
  let tokenEstimate: number | null = null;
  let analysisData: PieceAiAnalysisData;

  if (pdf) {
    const pdfDoc = await PDFDocument.load(fileBuf, { ignoreEncryption: true });
    pageCountSent = pdfDoc.getPageCount();
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
    analysisData = await callOpenAiPieceAnalysis(openai, {
      prompt: systemPrompt,
      pdfBase64,
    });
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
