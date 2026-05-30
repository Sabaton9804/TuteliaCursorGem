import type OpenAI from 'openai';
import type { TextReviewIssue, TextReviewResult } from '../src/lib/ai-despacho-assist.ts';
import { AI_REVIEW_MAX_CHARS } from '../src/lib/ai-despacho-assist.ts';

const REVIEW_PROMPT_VERSION = 'v1.0';

const REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    corrected_text: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            enum: ['ortografia', 'gramatica', 'estilo', 'puntuacion'],
          },
          excerpt: { type: 'string' },
          suggestion: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['kind', 'excerpt', 'suggestion', 'note'],
      },
    },
  },
  required: ['summary', 'corrected_text', 'issues'],
} as const;

function reviewModel(): string {
  return (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
}

export function reviewPromptVersion(): string {
  return REVIEW_PROMPT_VERSION;
}

export async function reviewJudicialText(
  openai: OpenAI,
  opts: { text: string; documentLabel?: string }
): Promise<TextReviewResult & { model: string; promptVersion: string }> {
  const raw = String(opts.text || '').trim();
  if (!raw) {
    throw Object.assign(new Error('No hay texto para revisar.'), { status: 400 });
  }
  const text = raw.length > AI_REVIEW_MAX_CHARS ? raw.slice(0, AI_REVIEW_MAX_CHARS) : raw;
  const label = String(opts.documentLabel || 'Documento del despacho').trim();

  const system = `Eres corrector de textos jurídicos en español (Colombia). Revisa ortografía, gramática, puntuación y claridad formal.
- No cambies el sentido jurídico ni inventes hechos.
- Conserva nombres propios, radicados y citas.
- "corrected_text" debe ser el texto completo corregido, listo para pegar en el despacho.
- "issues": hasta 25 hallazgos representativos (excerpt breve del original, suggestion, note opcional).
- Tono: providencia judicial colombiana.`;

  const user = `Documento: ${label}\n\n--- TEXTO ---\n${text}`;

  const model = reviewModel();
  const result = await openai.responses.create({
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'revision_redaccion',
        schema: REVIEW_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  let parsed: {
    summary?: string;
    corrected_text?: string;
    issues?: Array<{
      kind?: string;
      excerpt?: string;
      suggestion?: string;
      note?: string;
    }>;
  };
  try {
    parsed = JSON.parse(result.output_text || '{}') as typeof parsed;
  } catch {
    throw new Error('La IA no devolvió una revisión válida.');
  }

  const issues: TextReviewIssue[] = (parsed.issues || [])
    .filter((i) => i && typeof i === 'object')
    .map((i) => ({
      kind:
        i.kind === 'ortografia' ||
        i.kind === 'gramatica' ||
        i.kind === 'estilo' ||
        i.kind === 'puntuacion'
          ? i.kind
          : 'estilo',
      excerpt: String(i.excerpt || '').slice(0, 500),
      suggestion: String(i.suggestion || '').slice(0, 500),
      note: String(i.note || '').slice(0, 300),
    }));

  return {
    summary: String(parsed.summary || 'Revisión completada.').trim(),
    correctedText: String(parsed.corrected_text || text).trim(),
    issues,
    model,
    promptVersion: REVIEW_PROMPT_VERSION,
  };
}
