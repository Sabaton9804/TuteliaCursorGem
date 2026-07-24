/**
 * synthesize-case-service.ts
 * PROMPT_VERSION: 2026-07-16.v1
 *
 * Un solo template parametrizado por caseType (civil | tutela).
 * Salida JSON validada con zod + reintento; se formatea a markdown
 * para la UI (CaseSintesisPanel / cases.summary).
 */

import { z } from 'zod';
import type OpenAI from 'openai';
import { createOpenAiModelClient, tryParseJson, type ModelClient } from './openai-model-client.js';

export const SYNTHESIS_PROMPT_VERSION = '2026-07-16.v1';

export type CaseSynthesisInput = {
  radicado: string;
  caseType: string | null;
  claimant: string;
  defendant: string;
  subject?: string | null;
  status?: string | null;
  operationalStatus?: string | null;
  deadlineAt?: string | null;
  assignedTo?: string | null;
  legalHechos?: string | null;
  legalPretensiones?: string | null;
  legalDerechoTutelado?: string | null;
  rawText?: string | null;
  catalogMetadata?: Record<string, unknown> | null;
  documentTitles?: string[];
  actionLines?: string[];
};

/** Buckets de prompt (extensible: laboral | familia | penal). */
export type SynthesisCaseKind = 'civil' | 'tutela';

interface CaseTypeConfig {
  specialistRole: string;
  taskDescription: string;
  formatName: string;
  outputBlocksInstructions: string;
}

const CASE_TYPE_CONFIG: Record<SynthesisCaseKind, CaseTypeConfig> = {
  civil: {
    specialistRole:
      'un asistente jurídico especializado en procesos civiles colombianos (CGP, Ley 1564 de 2012)',
    taskDescription:
      'Sintetiza el estado del proceso para uso interno del despacho judicial. Sé concreto y operativo.',
    formatName: 'Síntesis cognitiva operativa (civil)',
    outputBlocksInstructions: `
Genera exactamente estos 7 campos JSON:
- tipo: tipo de proceso (preferir etiqueta SIERJU Civil-Oral si consta)
- partes: demandante(s) y demandado(s)
- estado: estado procesal actual, una frase operativa
- actuacion_reciente: última actuación, con fecha si consta
- piezas: piezas relevantes para el seguimiento
- terminos: términos o plazos vigentes; si no hay: "no consta en el expediente"
- seguimiento: qué debe vigilar el despacho (1-3 acciones)`,
  },
  tutela: {
    specialistRole: 'un asistente jurídico especializado en derecho constitucional colombiano',
    taskDescription:
      'Sintetiza los puntos clave de una tutela / impugnación / consulta de desacato y el estado procesal útil para el despacho.',
    formatName: 'Síntesis operativa (tutela / constitucional)',
    outputBlocksInstructions: `
Genera exactamente estos campos JSON:
- derechos: derecho(s) fundamental(es) (etiquetas SIERJU hoja 8/13/15 si constan)
- hechos: máximo 3 hechos relevantes, frases breves
- pretension: qué se pide, en una frase
- urgencia: por qué es urgente o prioritario; si no aplica, indíquelo
- plazos: plazos / términos; si no constan: "no consta en el expediente"
- piezas: piezas relevantes para el seguimiento`,
  },
};

const civilSynthesisSchema = z.object({
  tipo: z.string().min(1),
  partes: z.string().min(1),
  estado: z.string().min(1),
  actuacion_reciente: z.string().min(1),
  piezas: z.string().min(1),
  terminos: z.string().min(1),
  seguimiento: z.string().min(1),
});

const tutelaSynthesisSchema = z.object({
  derechos: z.string().min(1),
  hechos: z.string().min(1),
  pretension: z.string().min(1),
  urgencia: z.string().min(1),
  plazos: z.string().min(1),
  piezas: z.string().min(1),
});

const SCHEMAS_BY_TYPE = {
  civil: civilSynthesisSchema,
  tutela: tutelaSynthesisSchema,
} as const;

type SynthesisResult<T extends SynthesisCaseKind> = z.infer<(typeof SCHEMAS_BY_TYPE)[T]>;

const ANTI_HALLUCINATION_GUARDRAIL = `
REGLA ABSOLUTA: solo puedes referenciar normas, artículos, fechas, radicados o
jurisprudencia que aparezcan literalmente en el expediente que se te entrega.
Si no tienes un dato (por ejemplo un plazo o una fecha), escribe explícitamente
"no consta en el expediente" en ese campo. NUNCA inventes ni completes un dato
faltante con una suposición razonable. Está prohibido citar sentencias, autos o
normas que no estén en el texto fuente.`;

function isCivilCaseType(caseType: string | null | undefined): boolean {
  return String(caseType ?? '').startsWith('civil_');
}

function metaStr(meta: Record<string, unknown> | null | undefined, key: string): string {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

/** Mapea case_type Jurion → bucket de síntesis. */
export function mapCaseTypeToSynthesisKind(
  caseType: string | null | undefined,
  catalogMetadata?: Record<string, unknown> | null,
): SynthesisCaseKind {
  if (isCivilCaseType(caseType) || catalogMetadata?.tipo_registro === 'civil') return 'civil';
  return 'tutela';
}

export function buildCaseSynthesisRawText(input: CaseSynthesisInput): string {
  const parts: string[] = [];
  const meta = input.catalogMetadata ?? {};
  const civil = isCivilCaseType(input.caseType) || meta.tipo_registro === 'civil';

  if (input.rawText?.trim()) {
    parts.push(input.rawText.trim());
  }

  if (civil) {
    parts.push(
      [
        '=== DATOS DEL PROCESO CIVIL (catálogo operativo) ===',
        `Radicado: ${input.radicado}`,
        metaStr(meta, 'tipo_proceso') ? `Tipo de proceso: ${metaStr(meta, 'tipo_proceso')}` : null,
        input.subject?.trim() ? `Materia/asunto: ${input.subject.trim()}` : null,
        metaStr(meta, 'situacion_plataforma')
          ? `Situación: ${metaStr(meta, 'situacion_plataforma')}`
          : null,
        metaStr(meta, 'etapa') ? `Etapa: ${metaStr(meta, 'etapa')}` : null,
        metaStr(meta, 'ubicacion_interna')
          ? `Ubicación interna: ${metaStr(meta, 'ubicacion_interna')}`
          : null,
        metaStr(meta, 'tramite_pendiente')
          ? `Trámite pendiente: ${metaStr(meta, 'tramite_pendiente')}`
          : null,
        metaStr(meta, 'encargado_nombre')
          ? `Encargado: ${metaStr(meta, 'encargado_nombre')}`
          : null,
        metaStr(meta, 'ultimo_auto_tipo')
          ? `Último auto: ${metaStr(meta, 'ultimo_auto_tipo')}${
              metaStr(meta, 'ultimo_auto_fecha') ? ` (${metaStr(meta, 'ultimo_auto_fecha')})` : ''
            }`
          : null,
        metaStr(meta, 'regimen') ? `Régimen: ${metaStr(meta, 'regimen')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (input.legalHechos?.trim()) parts.push(`HECHOS:\n${input.legalHechos.trim()}`);
  if (input.legalPretensiones?.trim()) parts.push(`PRETENSIONES:\n${input.legalPretensiones.trim()}`);
  if (input.legalDerechoTutelado?.trim()) {
    parts.push(`DERECHO / TIPIFICACIÓN:\n${input.legalDerechoTutelado.trim()}`);
  }

  if (input.actionLines?.length) {
    parts.push(`ACTUACIONES Y EVENTOS:\n${input.actionLines.map((l) => `- ${l}`).join('\n')}`);
  }

  if (input.documentTitles?.length) {
    parts.push(`PIEZAS EN EXPEDIENTE DIGITAL:\n${input.documentTitles.map((t) => `- ${t}`).join('\n')}`);
  }

  const body = parts.filter(Boolean).join('\n\n').trim();
  if (!body) {
    return [
      `Radicado ${input.radicado}`,
      `Demandante: ${input.claimant || '—'}`,
      `Demandado: ${input.defendant || '—'}`,
      input.subject?.trim() ? `Asunto: ${input.subject.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return body;
}

export function buildCaseSynthesisContextBlock(input: CaseSynthesisInput): string {
  const meta = input.catalogMetadata ?? {};
  const lines = [
    `Demandante: ${input.claimant || '—'}`,
    `Demandado: ${input.defendant || '—'}`,
    `Estado judicial: ${input.status || '—'}`,
    input.operationalStatus?.trim()
      ? `Estado operativo: ${input.operationalStatus.trim()}`
      : metaStr(meta, 'ubicacion_interna')
        ? `Ubicación interna: ${metaStr(meta, 'ubicacion_interna')}`
        : 'Estado operativo: no indicado.',
    input.deadlineAt?.trim()
      ? `Plazo registrado (deadline_at): ${input.deadlineAt.trim()}`
      : 'Plazo: no registrado.',
    input.assignedTo?.trim() || metaStr(meta, 'encargado_nombre')
      ? `Responsable: ${input.assignedTo?.trim() || metaStr(meta, 'encargado_nombre')}`
      : 'Responsable: sin asignación.',
    input.documentTitles?.length
      ? `Piezas (${input.documentTitles.length}): ${input.documentTitles.join(' · ')}`
      : 'Expediente digital: sin piezas listadas aún.',
  ];
  return lines.join('\n');
}

function buildExpedienteForPrompt(input: CaseSynthesisInput): string {
  const contextBlock = buildCaseSynthesisContextBlock(input);
  const rawText = buildCaseSynthesisRawText(input);
  const segundaNote =
    input.caseType === 'tutela_segunda'
      ? '\nNOTA: Expediente de SEGUNDA INSTANCIA (impugnación). Las partes procesales son las del fallo de primera instancia, no el juzgado remitente ni el despacho de segunda.\n'
      : '';
  return [
    `DEMANDANTE/ACCIONANTE: ${input.claimant || 'No especificado'}`,
    `DEMANDADO/ACCIONADO: ${input.defendant || 'No especificado'}`,
    segundaNote,
    '',
    '### Datos del expediente en el sistema',
    contextBlock.trim(),
    '',
    '### Información disponible del proceso',
    rawText,
  ].join('\n');
}

function buildSynthesisPrompt(caseType: SynthesisCaseKind, expedienteText: string): string {
  const config = CASE_TYPE_CONFIG[caseType];
  return `Eres ${config.specialistRole}.

${config.taskDescription}
${ANTI_HALLUCINATION_GUARDRAIL}

FORMATO DE SALIDA: ${config.formatName}
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown,
sin comillas triples. El JSON debe tener exactamente estos campos:
${config.outputBlocksInstructions}

--- EXPEDIENTE ---
${expedienteText}
--- FIN EXPEDIENTE ---`;
}

function buildRetryPrompt(
  caseType: SynthesisCaseKind,
  expedienteText: string,
  previousError: string,
): string {
  return `${buildSynthesisPrompt(caseType, expedienteText)}

ADVERTENCIA: tu respuesta anterior no cumplió el formato JSON requerido
(error: ${previousError}). Responde de nuevo, esta vez ÚNICAMENTE con el JSON
válido, sin ningún texto antes o después.`;
}

function formatCivilMarkdown(data: z.infer<typeof civilSynthesisSchema>): string {
  return `### Síntesis cognitiva operativa

**1. Tipo de proceso y objeto del litigio:** ${data.tipo}

**2. Partes y rol procesal:** ${data.partes}

**3. Estado procesal:** ${data.estado}

**4. Actuación reciente:** ${data.actuacion_reciente}

**5. Piezas y expediente:** ${data.piezas}

**6. Términos y riesgos:** ${data.terminos}

**7. Seguimiento sugerido:** ${data.seguimiento}
`;
}

function formatTutelaMarkdown(data: z.infer<typeof tutelaSynthesisSchema>): string {
  return `### Sintesis Operativa

**1. Derechos presuntamente vulnerados:** ${data.derechos}

**2. Hechos relevantes:** ${data.hechos}

**3. Pretension principal:** ${data.pretension}

**4. Urgencia detectada:** ${data.urgencia}

**5. Plazos, traslados y contestaciones:** ${data.plazos}

**6. Piezas y seguimiento:** ${data.piezas}
`;
}

function formatSynthesisMarkdown(
  kind: SynthesisCaseKind,
  data: SynthesisResult<SynthesisCaseKind>,
): string {
  if (kind === 'civil') {
    return formatCivilMarkdown(data as z.infer<typeof civilSynthesisSchema>);
  }
  return formatTutelaMarkdown(data as z.infer<typeof tutelaSynthesisSchema>);
}

const CIVIL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipo: { type: 'string' },
    partes: { type: 'string' },
    estado: { type: 'string' },
    actuacion_reciente: { type: 'string' },
    piezas: { type: 'string' },
    terminos: { type: 'string' },
    seguimiento: { type: 'string' },
  },
  required: [
    'tipo',
    'partes',
    'estado',
    'actuacion_reciente',
    'piezas',
    'terminos',
    'seguimiento',
  ],
} as const;

const TUTELA_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    derechos: { type: 'string' },
    hechos: { type: 'string' },
    pretension: { type: 'string' },
    urgencia: { type: 'string' },
    plazos: { type: 'string' },
    piezas: { type: 'string' },
  },
  required: ['derechos', 'hechos', 'pretension', 'urgencia', 'plazos', 'piezas'],
} as const;

async function synthesizeCaseStructured<T extends SynthesisCaseKind>(
  caseType: T,
  expedienteText: string,
  model: ModelClient,
): Promise<{ data: SynthesisResult<T>; firstAttemptOk: boolean }> {
  const schema = SCHEMAS_BY_TYPE[caseType];
  const prompt = buildSynthesisPrompt(caseType, expedienteText);

  const raw = await model.complete(prompt);
  const parsed = tryParseJson(raw);
  const validation = schema.safeParse(parsed);

  if (validation.success) {
    return { data: validation.data as SynthesisResult<T>, firstAttemptOk: true };
  }

  const retryPrompt = buildRetryPrompt(caseType, expedienteText, validation.error.message);
  const rawRetry = await model.complete(retryPrompt);
  const parsedRetry = tryParseJson(rawRetry);
  const retryValidation = schema.safeParse(parsedRetry);

  if (retryValidation.success) {
    return { data: retryValidation.data as SynthesisResult<T>, firstAttemptOk: false };
  }

  throw new Error(
    `synthesize-case-service: JSON inválido para caseType="${caseType}" tras reintento. ${retryValidation.error.message}`,
  );
}

export type CaseSynthesisDetailed = {
  markdown: string;
  kind: SynthesisCaseKind;
  firstAttemptOk: boolean;
  promptVersion: string;
  data: SynthesisResult<SynthesisCaseKind>;
};

/** API detallada (validación pre-merge): incluye si zod pasó al primer intento. */
export async function generateCaseSynthesisDetailed(
  openai: OpenAI,
  input: CaseSynthesisInput,
  modelName?: string,
): Promise<CaseSynthesisDetailed> {
  const rawText = buildCaseSynthesisRawText(input);
  if (!rawText.trim()) {
    throw new Error('Sin texto suficiente para generar síntesis');
  }

  const kind = mapCaseTypeToSynthesisKind(input.caseType, input.catalogMetadata);
  const expedienteText = buildExpedienteForPrompt(input);
  const jsonSchema =
    kind === 'civil'
      ? { name: 'sintesis_civil', schema: CIVIL_JSON_SCHEMA as unknown as Record<string, unknown> }
      : { name: 'sintesis_tutela', schema: TUTELA_JSON_SCHEMA as unknown as Record<string, unknown> };

  const model = createOpenAiModelClient(openai, { model: modelName, jsonSchema });
  const { data, firstAttemptOk } = await synthesizeCaseStructured(kind, expedienteText, model);
  return {
    markdown: formatSynthesisMarkdown(kind, data),
    kind,
    firstAttemptOk,
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    data,
  };
}

/**
 * API usada por `/api/ai/summarize` y batch scripts.
 * Devuelve markdown listo para `cases.summary`.
 */
export async function generateCaseSynthesis(
  openai: OpenAI,
  input: CaseSynthesisInput,
  modelName?: string,
): Promise<string> {
  const detailed = await generateCaseSynthesisDetailed(openai, input, modelName);
  return detailed.markdown;
}

export { synthesizeCaseStructured as synthesizeCase };
