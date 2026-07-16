import type OpenAI from 'openai';

/**
 * Adaptador mínimo sobre el cliente OpenAI del proyecto.
 * Los servicios de prompt (síntesis, legal-analysis) dependen de esta firma,
 * no de responses.create directamente.
 */
export type ModelClient = {
  complete: (prompt: string) => Promise<string>;
  /** Completar con PDF adjunto (multimodal). */
  completeWithPdf?: (prompt: string, pdfBase64: string, filename?: string) => Promise<string>;
};

export function createOpenAiModelClient(
  openai: OpenAI,
  opts?: { model?: string; jsonSchema?: { name: string; schema: Record<string, unknown> } },
): ModelClient {
  const model = (opts?.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const jsonSchema = opts?.jsonSchema;

  async function run(
    content: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_file'; filename: string; file_data: string }
    >,
  ): Promise<string> {
    const result = await openai.responses.create({
      model,
      input: [{ role: 'user', content }],
      ...(jsonSchema
        ? {
            text: {
              format: {
                type: 'json_schema' as const,
                name: jsonSchema.name,
                schema: jsonSchema.schema,
                strict: true,
              },
            },
          }
        : {}),
    });
    return (result.output_text || '').trim();
  }

  return {
    complete: (prompt: string) => run([{ type: 'input_text', text: prompt }]),
    completeWithPdf: (prompt: string, pdfBase64: string, filename = 'documento.pdf') => {
      const b64 = pdfBase64.replace(/^data:application\/pdf;base64,/i, '');
      return run([
        { type: 'input_text', text: prompt },
        {
          type: 'input_file',
          filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
          file_data: `data:application/pdf;base64,${b64}`,
        },
      ]);
    },
  };
}

export function tryParseJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
