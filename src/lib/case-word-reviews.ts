import { supabase } from './supabase';
import type { CaseWordReview, CaseWordReviewMarkupV1, WordReviewStatus } from '../types';
import { rowToCaseWordReview } from './supabase-mappers';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';

export async function fetchCaseWordReviews(caseId: string): Promise<CaseWordReview[]> {
  const { data, error } = await supabase
    .from('case_word_reviews')
    .select('*')
    .eq('case_id', caseId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToCaseWordReview(r as Record<string, unknown>));
}

export async function createCaseWordReview(
  caseId: string,
  wordDocumentId: string,
  /** Si se envía, queda persistido al crear el ciclo (p. ej. borrador TipTap del despacho). */
  reviewMarkupJson?: CaseWordReviewMarkupV1 | null,
): Promise<CaseWordReview> {
  await ensureSupabaseSessionForWrites();
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user?.id ?? null;
  const now = new Date().toISOString();
  const insertRow: Record<string, unknown> = {
    case_id: caseId,
    word_document_id: wordDocumentId,
    status: 'pendiente_juez',
    created_by: uid,
    created_at: now,
    updated_at: now,
  };
  if (reviewMarkupJson != null) {
    insertRow.review_markup_json = reviewMarkupJson;
  }
  const { data, error } = await supabase.from('case_word_reviews').insert(insertRow).select('*').single();
  if (error) throw error;
  return rowToCaseWordReview(data as Record<string, unknown>);
}

export async function updateCaseWordReview(
  id: string,
  patch: Partial<{
    wordDocumentId: string;
    status: WordReviewStatus;
    judgeNotes: string | null;
    sustanciadorReply: string | null;
    signedPdfDocumentId: string | null;
    reviewMarkupJson: CaseWordReviewMarkupV1 | null;
  }>,
): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.wordDocumentId !== undefined) row.word_document_id = patch.wordDocumentId;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.judgeNotes !== undefined) row.judge_notes = patch.judgeNotes;
  if (patch.sustanciadorReply !== undefined) row.sustanciador_reply = patch.sustanciadorReply;
  if (patch.signedPdfDocumentId !== undefined) row.signed_pdf_document_id = patch.signedPdfDocumentId;
  if (patch.reviewMarkupJson !== undefined) row.review_markup_json = patch.reviewMarkupJson;
  const { data, error } = await supabase.from('case_word_reviews').update(row).eq('id', id).select('id, status');
  if (error) throw error;
  if (!data?.length) {
    throw new Error(
      'No se actualizó ninguna fila en case_word_reviews (id no encontrado o sin permiso). Revise RLS y el id de la revisión.',
    );
  }
}
