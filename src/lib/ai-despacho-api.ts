import { supabase } from './supabase';
import { apiUrl } from './api-base';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';
import type { TextReviewResult } from './ai-despacho-assist';

async function authHeaders(): Promise<HeadersInit> {
  await ensureSupabaseSessionForWrites();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function aiReviewJudicialText(opts: {
  text: string;
  documentLabel?: string;
}): Promise<TextReviewResult> {
  const res = await fetch(apiUrl('/api/ai/review-text'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      text: opts.text,
      documentLabel: opts.documentLabel,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as TextReviewResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Error al revisar redacción (${res.status})`);
  }
  return {
    summary: body.summary,
    correctedText: body.correctedText,
    issues: body.issues || [],
  };
}

export type PrecedentSearchHit = {
  id: string;
  source_type?: string | null;
  source_corporation?: string | null;
  source_case_id?: string | null;
  radicado: string;
  right_protected: string;
  defendant: string;
  ruling_sense: string;
  summary: string;
  matched_snippet?: string | null;
  similarity: number;
};

export async function searchPrecedentsForCase(opts: {
  courtId: string;
  queryText: string;
}): Promise<PrecedentSearchHit[]> {
  const res = await fetch(apiUrl('/api/precedents/search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courtId: opts.courtId,
      queryText: opts.queryText,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { results?: PrecedentSearchHit[]; error?: string };
  if (!res.ok) {
    throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo consultar precedentes');
  }
  return Array.isArray(j.results) ? j.results : [];
}
