import OpenAI from 'openai';
import { createOpenAiTlsInsecureFetch } from './openai-insecure-fetch';
import type { SegundaFieldsExtract } from '../src/lib/segunda-instancia-extract.ts';
import type { CaseAppellant, CaseOriginRuling } from '../src/types.ts';
import { sgdeLeafDisplayPath, type SgdePdfLeaf } from './sgde-client';

const SEGUNDA_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    impugnante: {
      type: 'string',
      enum: ['accionante', 'accionado', 'desconocido'],
    },
    fallo_origen: {
      type: 'string',
      enum: ['concedio', 'nego', 'desconocido'],
    },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    notas: { type: 'string' },
  },
  required: ['impugnante', 'fallo_origen', 'confianza', 'notas'],
  additionalProperties: false,
} as const;

const IA_TIMEOUT_MS = 45_000;
const PDF_MAX_BYTES = 8 * 1024 * 1024;

type IaSegundaExtract = {
  impugnante: 'accionante' | 'accionado' | 'desconocido';
  fallo_origen: 'concedio' | 'nego' | 'desconocido';
  confianza: 'alta' | 'media' | 'baja';
  notas: string;
};

function createOpenAi(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const insecure = ['1', 'true', 'yes'].includes(String(process.env.OPENAI_TLS_INSECURE || '').toLowerCase());
  if (insecure) return new OpenAI({ apiKey, fetch: createOpenAiTlsInsecureFetch() });
  return new OpenAI({ apiKey });
}

function mapIaToFields(
  raw: IaSegundaExtract,
  sources: string[]
): SegundaFieldsExtract {
  const appellant: CaseAppellant | null =
    raw.impugnante === 'accionante' || raw.impugnante === 'accionado' ? raw.impugnante : null;
  const originRuling: CaseOriginRuling | null =
    raw.fallo_origen === 'concedio' || raw.fallo_origen === 'nego' ? raw.fallo_origen : null;
  const outSources = [...sources];
  if (raw.notas?.trim() && raw.confianza !== 'baja') {
    outSources.push(`IA: ${raw.notas.trim().slice(0, 120)}`);
  }
  return { appellant, originRuling, sources: outSources };
}

export async function extractSegundaFieldsWithOpenAi(opts: {
  emailDigest?: string;
  pdfFiles: Array<{ buffer: Buffer; filename: string; label: string }>;
}): Promise<SegundaFieldsExtract | null> {
  const openai = createOpenAi();
  if (!openai) {
    console.warn('[sgde/segunda-ia] OPENAI_API_KEY no configurada; solo heurística.');
    return null;
  }

  const pdfs = opts.pdfFiles.filter((p) => p.buffer.length > 0 && p.buffer.length <= PDF_MAX_BYTES);
  if (pdfs.length === 0 && !opts.emailDigest?.trim()) return null;

  const docList = pdfs.map((p) => `- ${p.label}`).join('\n');
  const prompt = `Eres secretario judicial en Colombia. Analiza el traslado de una ACCIÓN DE TUTELA en SEGUNDA INSTANCIA (impugnación, no apelación).

Determina:
1) impugnante: ¿quién impugna el fallo de primera instancia? Solo "accionante" o "accionado" si el documento lo deja claro; si no, "desconocido".
2) fallo_origen: ¿el juzgado de primera instancia CONCEDIÓ o NEGÓ la tutela? "concedio" o "nego"; si no se puede saber, "desconocido".

Reglas:
- En tutela no existe apelación; use solo impugnación.
- Priorice el PDF de fallo/sentencia de primera instancia para fallo_origen.
- Priorice correo o escrito de impugnación para impugnante.
- No invente; use desconocido si el PDF es ilegible o no aplica.

Documentos adjuntos:
${docList || '(sin PDF legible)'}

${opts.emailDigest?.trim() ? `--- TEXTO DEL CORREO DE TRASLADO ---\n${opts.emailDigest.trim().slice(0, 6000)}` : ''}`;

  const content: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_file'; filename: string; file_data: string }
  > = [{ type: 'input_text', text: prompt }];

  for (const p of pdfs.slice(0, 3)) {
    content.push({
      type: 'input_file',
      filename: p.filename.endsWith('.pdf') ? p.filename : `${p.filename}.pdf`,
      file_data: `data:application/pdf;base64,${p.buffer.toString('base64')}`,
    });
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IA_TIMEOUT_MS);

  try {
    const res = await openai.responses.create(
      {
        model,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'segunda_instancia_campos',
            schema: SEGUNDA_EXTRACT_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        },
      },
      { signal: controller.signal }
    );
    const raw = JSON.parse(res.output_text || '{}') as IaSegundaExtract;
    if (raw.confianza === 'baja' && raw.impugnante === 'desconocido' && raw.fallo_origen === 'desconocido') {
      return null;
    }
    return mapIaToFields(raw, pdfs.map((p) => p.label));
  } catch (e) {
    console.warn('[sgde/segunda-ia] OpenAI:', (e as Error)?.message || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function pickPdfCandidatesForIa(
  falloLeaf: SgdePdfLeaf | null,
  impLeaf: SgdePdfLeaf | null
): SgdePdfLeaf[] {
  const out: SgdePdfLeaf[] = [];
  if (falloLeaf) out.push(falloLeaf);
  if (impLeaf && impLeaf.id !== falloLeaf?.id) out.push(impLeaf);
  return out;
}

export function leafLabel(leaf: SgdePdfLeaf): string {
  return sgdeLeafDisplayPath(leaf);
}
