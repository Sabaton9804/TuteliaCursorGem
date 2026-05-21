import type { OpenAI } from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type CanonicalChunk,
  type PrecedentCanonicalInput,
  buildCanonicalPrecedentDocument,
  chunkCanonicalDocument,
} from './precedent-chunking.js';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

export function vectorToPgString(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/** Entrada de consulta o chunk único; tope conservador bajo el límite de tokens del modelo (~8192). */
export async function createEmbedding1536(openai: OpenAI, input: string): Promise<number[]> {
  const trimmed = input.trim().slice(0, 28000);
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

const BATCH = 48;

export async function embedTextsBatch(openai: OpenAI, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => {
      const s = t.trim().slice(0, 28000) || '—';
      return s;
    });
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIM,
    });
    const rows = res.data ?? [];
    if (rows.length !== batch.length) {
      throw new Error(`Embedding batch: esperados ${batch.length} vectores, recibidos ${rows.length}.`);
    }
    const ordered =
      rows.length > 0 && rows.every((r) => typeof r.index === 'number')
        ? [...rows].sort((a, b) => (a.index as number) - (b.index as number))
        : rows;
    for (const row of ordered) {
      const vec = row.embedding;
      if (!vec?.length || vec.length !== EMBEDDING_DIM) {
        throw new Error('Respuesta de embedding batch inválida.');
      }
      out.push(vec);
    }
  }
  return out;
}

export type MatchPrecedentChunkRow = {
  chunk_id: string;
  precedent_id: string;
  chunk_index: number;
  chunk_content: string;
  chunk_meta: Record<string, unknown> | null;
  source_case_id: string | null;
  source_type: string | null;
  source_corporation: string | null;
  radicado: string;
  right_protected: string;
  defendant: string;
  ruling_sense: string;
  summary: string;
  legal_arguments: string;
  source_excerpt: string | null;
  decision_date: string | null;
  tags: unknown;
  similarity: number;
};

export type PrecedentSearchResult = {
  id: string;
  source_case_id: string | null;
  source_type: string | null;
  source_corporation: string | null;
  radicado: string;
  right_protected: string;
  defendant: string;
  ruling_sense: string;
  summary: string;
  legal_arguments: string;
  source_excerpt: string | null;
  decision_date: string | null;
  tags: unknown;
  similarity: number;
  matched_snippet: string | null;
  matched_chunk_index: number | null;
  matched_char_start: number | null;
  matched_char_end: number | null;
};

function offsetsFromChunkMeta(meta: Record<string, unknown> | null): {
  charStart: number | null;
  charEnd: number | null;
} {
  if (!meta || typeof meta !== 'object') {
    return { charStart: null, charEnd: null };
  }
  const charStart = typeof meta.char_start === 'number' ? meta.char_start : null;
  const charEnd = typeof meta.char_end === 'number' ? meta.char_end : null;
  return { charStart, charEnd };
}

export function aggregateChunkMatches(rows: MatchPrecedentChunkRow[], topPrecedents: number): PrecedentSearchResult[] {
  const bestByPrec = new Map<string, { row: MatchPrecedentChunkRow; sim: number }>();
  for (const row of rows) {
    const pid = row.precedent_id;
    const prev = bestByPrec.get(pid);
    const sim = Number(row.similarity);
    if (!prev || sim > prev.sim) {
      bestByPrec.set(pid, { row, sim });
    }
  }
  const sorted = [...bestByPrec.values()].sort((a, b) => b.sim - a.sim).slice(0, topPrecedents);
  return sorted.map(({ row, sim }) => {
    const { charStart, charEnd } = offsetsFromChunkMeta(row.chunk_meta);
    return {
      id: row.precedent_id,
      source_case_id: row.source_case_id,
      source_type: row.source_type,
      source_corporation: row.source_corporation,
      radicado: row.radicado,
      right_protected: row.right_protected,
      defendant: row.defendant,
      ruling_sense: row.ruling_sense,
      summary: row.summary,
      legal_arguments: row.legal_arguments,
      source_excerpt: row.source_excerpt,
      decision_date: row.decision_date,
      tags: row.tags,
      similarity: sim,
      matched_snippet: row.chunk_content?.trim() || null,
      matched_chunk_index: row.chunk_index ?? null,
      matched_char_start: charStart,
      matched_char_end: charEnd,
    };
  });
}

export async function insertPrecedentChunkRows(
  supabase: SupabaseClient,
  precedentId: string,
  courtId: string,
  chunks: CanonicalChunk[],
  vectors: number[][]
): Promise<void> {
  if (chunks.length !== vectors.length) {
    throw new Error('insertPrecedentChunkRows: chunks y vectores no coinciden.');
  }
  const rows = chunks.map((c, i) => ({
    precedent_id: precedentId,
    court_id: courtId,
    chunk_index: i,
    content: c.text,
    meta: c.meta as unknown as Record<string, unknown>,
    embedding: vectorToPgString(vectors[i]),
  }));
  const chunkSize = 80;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('precedent_chunks').insert(slice);
    if (error) throw error;
  }
}

export function buildChunksForPrecedent(input: PrecedentCanonicalInput): CanonicalChunk[] {
  const canonical = buildCanonicalPrecedentDocument(input);
  return chunkCanonicalDocument(canonical);
}
