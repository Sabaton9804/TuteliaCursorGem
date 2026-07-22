import { supabase } from './supabase';
import { apiUrl } from './api-base';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';
import type { PieceAiAnalysisData, PieceAiAnalysisResponse } from './piece-ai-analysis';
import { PIECE_AI_PROMPT_VERSION } from './piece-ai-analysis';

async function authHeaders(): Promise<HeadersInit> {
  await ensureSupabaseSessionForWrites();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Inicie sesión en Tutelia para usar la lectura rápida con IA.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function loadCachedPieceAiAnalysis(
  caseDocumentId: string,
  opts?: { fileHash?: string }
): Promise<PieceAiAnalysisResponse | null> {
  const { data, error } = await supabase
    .from('case_document_ai_analyses')
    .select(
      'content_hash, page_count_sent, analysis_data, summary_markdown, prompt_version, created_at'
    )
    .eq('case_document_id', caseDocumentId)
    .maybeSingle();

  if (error || !data) return null;
  if (data.prompt_version !== PIECE_AI_PROMPT_VERSION) return null;
  const hash = String(data.content_hash || '');
  if (opts?.fileHash && hash && opts.fileHash !== hash) return null;

  return {
    cached: true,
    contentHash: hash,
    pageCountSent: Number(data.page_count_sent) || 0,
    analysisData: data.analysis_data as PieceAiAnalysisData,
    summaryMarkdown: String(data.summary_markdown || ''),
    analyzedAt: typeof data.created_at === 'string' ? data.created_at : undefined,
  };
}

export async function fetchPieceAiAnalysis(opts: {
  caseId: string;
  caseDocumentId: string;
  forceRefresh?: boolean;
  pdfPageCount?: number | null;
}): Promise<PieceAiAnalysisResponse> {
  const res = await fetch(apiUrl('/api/ai/analyze-piece'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      caseId: opts.caseId,
      caseDocumentId: opts.caseDocumentId,
      forceRefresh: Boolean(opts.forceRefresh),
      pdfPageCount:
        typeof opts.pdfPageCount === 'number' && opts.pdfPageCount > 0
          ? Math.floor(opts.pdfPageCount)
          : undefined,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as PieceAiAnalysisResponse & { error?: string };
  if (!res.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `Error al analizar la pieza (${res.status})`);
  }
  return body;
}
