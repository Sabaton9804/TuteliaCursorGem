/** Umbrales y límites de búsqueda vectorial de precedentes (pgvector / RPC). */
export const PRECEDENT_SEARCH_CONFIG = {
  CHUNK_MATCH_THRESHOLD: 0.22,
  CHUNK_LIMIT: 48,
  TOP_PRECEDENTS: 3,
  LEGACY_MATCH_THRESHOLD: 0.30,
  LEGACY_TOP: 3,
} as const;
