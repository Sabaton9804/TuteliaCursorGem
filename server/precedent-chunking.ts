/**
 * Fragmentación de precedentes para embeddings.
 * Sin dependencia de tiktoken (límites por caracteres, conservadores para español jurídico ~3–4 chars/token).
 */

export type PrecedentCanonicalInput = {
  radicado: string;
  rightProtected: string;
  rulingSense: string;
  defendant: string;
  legalArguments: string;
  summary: string;
  sourceType: 'despacho' | 'jurisprudencia';
  sourceCorporation: string | null;
};

export type CanonicalChunk = {
  text: string;
  meta: {
    v: 1;
    char_start: number;
    char_end: number;
  };
};

const DEFAULT_MAX_CHUNK_CHARS = 2800;
const DEFAULT_OVERLAP_CHARS = 380;
const DEFAULT_MAX_CHUNKS = 160;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function precedentChunkConfig() {
  return {
    maxChunkChars: envInt('PRECEDENT_CHUNK_MAX_CHARS', DEFAULT_MAX_CHUNK_CHARS),
    overlapChars: envInt('PRECEDENT_CHUNK_OVERLAP_CHARS', DEFAULT_OVERLAP_CHARS),
    maxChunks: envInt('PRECEDENT_MAX_CHUNKS', DEFAULT_MAX_CHUNKS),
  };
}

export function buildCanonicalPrecedentDocument(input: PrecedentCanonicalInput): string {
  const lines: string[] = [];
  const ref = String(input.radicado || '').trim();
  if (ref) lines.push(`Radicado o referencia: ${ref}`);
  if (input.sourceType === 'jurisprudencia') {
    const corp = (input.sourceCorporation || '').trim();
    if (corp) lines.push(`Corporación: ${corp}`);
  } else {
    const def = String(input.defendant || '').trim();
    if (def) lines.push(`Accionado: ${def}`);
  }
  const materia = String(input.rightProtected || '').trim();
  if (materia) lines.push(`Materia / derecho: ${materia}`);
  const sentido = String(input.rulingSense || '').trim();
  if (sentido) lines.push(`Sentido del fallo: ${sentido}`);

  const args = String(input.legalArguments || '').trim();
  const sum = String(input.summary || '').trim();

  const head = lines.join('\n');
  const parts: string[] = [];
  if (head) parts.push(head);
  if (args) parts.push(`---\n${args}`);
  if (sum) parts.push(`---\nResumen: ${sum}`);

  const doc = parts.join('\n\n').trim();
  return doc || '—';
}

/**
 * Corta en párrafos cuando sea posible para no romper mitad de frase.
 */
export function chunkCanonicalDocument(fullText: string, opts?: Partial<ReturnType<typeof precedentChunkConfig>>): CanonicalChunk[] {
  const { maxChunkChars, overlapChars, maxChunks } = { ...precedentChunkConfig(), ...opts };
  const text = fullText.replace(/\r\n/g, '\n').trim();
  if (!text) {
    return [
      {
        text: '—',
        meta: { v: 1, char_start: 0, char_end: 1 },
      },
    ];
  }

  const chunks: CanonicalChunk[] = [];
  let start = 0;

  while (start < text.length && chunks.length < maxChunks) {
    let end = Math.min(start + maxChunkChars, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const lastPara = window.lastIndexOf('\n\n');
      const lastDot = window.lastIndexOf('. ');
      const breakAt = Math.max(lastPara > 800 ? lastPara + 2 : -1, lastDot > 800 ? lastDot + 2 : -1);
      if (breakAt > 400) {
        end = start + breakAt;
      }
    }

    const slice = text.slice(start, end).trim();
    if (slice.length > 0) {
      chunks.push({
        text: slice,
        meta: { v: 1, char_start: start, char_end: end },
      });
    }

    if (end >= text.length) break;
    const nextStart = end - overlapChars;
    start = nextStart > start ? nextStart : end;
  }

  if (!chunks.length) {
    return [{ text: text.slice(0, maxChunkChars), meta: { v: 1, char_start: 0, char_end: Math.min(maxChunkChars, text.length) } }];
  }

  return chunks;
}
