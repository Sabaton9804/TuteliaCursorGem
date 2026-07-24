/**
 * legal-analysis-service.ts
 * PROMPT_VERSION: 2026-07-16.v1
 *
 * El cliente manda SOLO datos crudos (caseType + pdfBase64 + flags de truncado).
 * El prompt se construye aquí; no se acepta `prompt` desde el cliente.
 *
 * caseType (4 buckets de radicación Jurion):
 * - civil        ← civil_* (hoja 2 Civil-Oral)
 * - tutela       ← tutela_primera (hoja 8)
 * - impugnacion  ← tutela_segunda (hoja 13)
 * - consulta     ← consulta_desacato (hoja 15)
 *
 * No hay quinto trámite radicable con tipificación distinta hoy
 * (incidente desacato hoja 12 vive sobre expediente existente).
 */

import { z } from 'zod';
import type OpenAI from 'openai';
import { sierjuCivilTipoLabelsForPrompt } from '../src/lib/sierju-process-tipos.ts';
import { sierjuDerechoTipoLabelsForPrompt } from '../src/lib/sierju-case-codes.ts';
import { createOpenAiModelClient, tryParseJson, type ModelClient } from './openai-model-client.js';

export const LEGAL_ANALYSIS_PROMPT_VERSION = '2026-07-16.v1';

export const LegalAnalysisRequestSchema = z.object({
  caseType: z.enum(['civil', 'tutela', 'impugnacion', 'consulta']),
  /** PDF en base64 (con o sin data-URL). Preferido: multimodal. */
  pdfBase64: z.string().min(1).optional(),
  /** Texto ya extraído (fallback si no hay PDF). */
  pdfText: z.string().min(1).optional(),
  /** En impugnación: fallo PI vs documento de traslado/radicación. */
  documentKind: z.enum(['radicacion', 'fallo_primera']).default('radicacion'),
  pdfWasTruncated: z.boolean().default(false),
  truncatedToPages: z.number().int().positive().optional(),
  totalPages: z.number().int().positive().optional(),
}).refine((v) => Boolean(v.pdfBase64?.trim() || v.pdfText?.trim()), {
  message: 'Se requiere pdfBase64 o pdfText',
});

export type LegalAnalysisRequest = z.infer<typeof LegalAnalysisRequestSchema>;

const partySchema = z.object({
  nombre: z.string(),
  identificacion: z.string(),
  email: z.string(),
});

/** Shape que consume NewCase (normalizeLegalAnalysis). */
export const LegalAnalysisResultSchema = z.object({
  accionantes: z.array(partySchema).min(1),
  accionados: z.array(partySchema).min(1),
  derechoTutelado: z.string().min(1),
  hechos: z.string().min(1),
  pretensiones: z.string().min(1),
});

export type LegalAnalysisResult = z.infer<typeof LegalAnalysisResultSchema>;

const OPENAI_LEGAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accionantes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nombre: { type: 'string' },
          identificacion: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['nombre', 'identificacion', 'email'],
      },
    },
    accionados: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nombre: { type: 'string' },
          identificacion: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['nombre', 'identificacion', 'email'],
      },
    },
    derechoTutelado: { type: 'string' },
    hechos: { type: 'string' },
    pretensiones: { type: 'string' },
  },
  required: ['accionantes', 'accionados', 'derechoTutelado', 'hechos', 'pretensiones'],
} as const;

const TIPIFICACION_CONFIG: Record<LegalAnalysisRequest['caseType'], string> = {
  civil: `derechoTutelado DEBE ser exactamente UNA etiqueta SIERJU «TIPOS PROCESOS» de Primera y única instancia Civil-Oral (hoja 2). Copie el texto tal cual; no use Civil-Escrito.
${sierjuCivilTipoLabelsForPrompt('oral')}`,
  tutela: `derechoTutelado DEBE ser exactamente UNA etiqueta SIERJU de Movimiento de Tutelas (hoja 8). NO use Acciones constitucionales (hojas 7/14).
${sierjuDerechoTipoLabelsForPrompt('movimiento_tutelas')}`,
  impugnacion: `derechoTutelado DEBE ser exactamente UNA etiqueta SIERJU de Movimiento de Impugnaciones (hoja 13). Mismos 12 derechos que tutelas.
${sierjuDerechoTipoLabelsForPrompt('impugnaciones')}`,
  consulta: `derechoTutelado DEBE ser exactamente UNA etiqueta SIERJU de Consultas Incidentes de Desacato (hoja 15).
${sierjuDerechoTipoLabelsForPrompt('consultas_desacato')}`,
};

const HECHOS_STYLE_BY_TYPE: Record<LegalAnalysisRequest['caseType'], string> = {
  civil:
    'Redacta hechos en un párrafo narrativo extenso, tercera persona, con partes, objeto del litigio, cuantía si consta y hechos del libelo.',
  tutela:
    'Redacta hechos en un párrafo narrativo, tercera persona, priorizando quién actúa, contra quién, perjuicio y trámites previos.',
  impugnacion:
    'Redacta hechos en un párrafo narrativo, tercera persona, incluyendo el sentido del fallo impugnado si consta.',
  consulta:
    'Redacta hechos en un párrafo narrativo, tercera persona, incluyendo el motivo de la consulta de desacato si consta.',
};

const ANTI_HALLUCINATION_GUARDRAIL = `
REGLA ABSOLUTA: usa ÚNICAMENTE la información del documento entregado.
No inventes fechas, radicados, normas, partes ni pretensiones.
Si un dato no aparece, usa cadena vacía en identificación/email o "no consta en el documento" en texto libre.
Si el derecho no encaja claramente en la lista SIERJU, use OTROS (tutela/impugnación/consulta) u OTROS PROCESOS (civil).`;

const NO_FIRST_PERSON_GUARDRAIL =
  "No uses primera persona ni comillas textuales en 'pretensiones'. Síntesis en tercera persona (4 a 6 frases).";

const MIN_HECHOS_CHARS = 900;
const MIN_HECHOS_SENTENCES = 10;

function countSentences(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function meetsLengthRequirements(result: LegalAnalysisResult): boolean {
  return (
    result.hechos.length >= MIN_HECHOS_CHARS &&
    countSentences(result.hechos) >= MIN_HECHOS_SENTENCES
  );
}

import { mapTuteliaCaseTypeToLegalAnalysisKind } from '../src/lib/legal-analysis-case-kind.ts';

export { mapTuteliaCaseTypeToLegalAnalysisKind };

const FALLO_PRIMERA_PROMPT = `
CONTEXTO ESPECIAL: el documento es el FALLO o SENTENCIA de tutela de PRIMERA INSTANCIA
(no el correo de remisión, ni el acta de reparto, ni el escrito de impugnación).
Extrae accionantes y accionados tal como constan en el fallo.
NO incluya juzgados, despachos judiciales, secretarías ni entidades remitentes como partes,
salvo que figuren expresamente como accionados en el litigio.
Incluya en hechos el sentido del fallo (concedió / negó) si consta.`;

function buildLegalAnalysisPrompt(req: LegalAnalysisRequest): string {
  const truncationNote = req.pdfWasTruncated
    ? `\nNOTA: Solo se adjuntan las primeras ${req.truncatedToPages ?? 'N'} páginas` +
      (req.totalPages ? ` de un PDF de ${req.totalPages}` : '') +
      '. Priorice cabecera, partes, tipificación, hechos iniciales y pretensiones. No invente anexos posteriores.'
    : '';

  const documentIntro =
    req.documentKind === 'fallo_primera'
      ? 'Analiza el fallo de tutela de primera instancia y extrae la información solicitada.'
      : 'Analiza el documento de radicación y extrae la información solicitada.';

  return `Eres un asistente jurídico especializado en derecho procesal colombiano (despacho civil de circuito).

${documentIntro}

Partes:
- accionantes: TODOS los demandantes / accionantes (nombre, C.C./NIT, correo si consta; si no, email vacío).
- accionados: TODOS los demandados / accionados (igual formato). Incluya litisconsortes.

Tipificación (campo derechoTutelado):
${TIPIFICACION_CONFIG[req.caseType]}

${HECHOS_STYLE_BY_TYPE[req.caseType]}
Mínimo 900 caracteres y al menos 10 frases en "hechos" si el documento lo permite.
En "pretensiones": ${NO_FIRST_PERSON_GUARDRAIL}
${ANTI_HALLUCINATION_GUARDRAIL}
${req.documentKind === 'fallo_primera' ? FALLO_PRIMERA_PROMPT : ''}
${truncationNote}

Responde ÚNICAMENTE con JSON válido según el esquema (accionantes, accionados, derechoTutelado, hechos, pretensiones).`;
}

function buildLengthRetryPrompt(basePrompt: string): string {
  return `${basePrompt}

ADVERTENCIA: tu respuesta anterior en "hechos" no cumplió el mínimo de
${MIN_HECHOS_CHARS} caracteres y ${MIN_HECHOS_SENTENCES} frases. Redacta un
párrafo narrativo más completo con los hechos del documento, sin relleno vacío.`;
}

async function callModel(
  model: ModelClient,
  prompt: string,
  req: LegalAnalysisRequest,
): Promise<string> {
  if (req.pdfBase64?.trim() && model.completeWithPdf) {
    return model.completeWithPdf(prompt, req.pdfBase64.trim());
  }
  const textBody = req.pdfText?.trim()
    ? `${prompt}\n\n--- TEXTO DEL DOCUMENTO ---\n${req.pdfText.trim()}\n--- FIN DEL DOCUMENTO ---`
    : prompt;
  return model.complete(textBody);
}

export async function runLegalAnalysis(
  rawRequest: unknown,
  model: ModelClient,
): Promise<{
  analysis: LegalAnalysisResult;
  lengthOk: boolean;
  promptVersion: string;
}> {
  const req = LegalAnalysisRequestSchema.parse(rawRequest);
  const prompt = buildLegalAnalysisPrompt(req);

  const raw = await callModel(model, prompt, req);
  const parsed = tryParseJson(raw);
  let validation = LegalAnalysisResultSchema.safeParse(parsed);

  if (!validation.success) {
    const retryRaw = await callModel(
      model,
      `${prompt}\n\nADVERTENCIA: JSON inválido (${validation.error.message}). Responde solo el JSON del esquema.`,
      req,
    );
    validation = LegalAnalysisResultSchema.safeParse(tryParseJson(retryRaw));
    if (!validation.success) {
      throw new Error(
        `legal-analysis-service: JSON inválido del modelo. ${validation.error.message}`,
      );
    }
  }

  let result = validation.data;
  let lengthOk = meetsLengthRequirements(result);

  if (!lengthOk) {
    console.warn(
      `[legal-analysis] hechos cortos (${result.hechos.length} chars); reintento con refuerzo`,
    );
    const retryRaw = await callModel(model, buildLengthRetryPrompt(prompt), req);
    const retryValidation = LegalAnalysisResultSchema.safeParse(tryParseJson(retryRaw));
    if (retryValidation.success) {
      result = retryValidation.data;
      lengthOk = meetsLengthRequirements(result);
      if (!lengthOk) {
        console.warn(
          `[legal-analysis] hechos aún cortos tras reintento (${result.hechos.length} chars); se acepta mejor esfuerzo`,
        );
      }
    }
  }

  return { analysis: result, lengthOk, promptVersion: LEGAL_ANALYSIS_PROMPT_VERSION };
}

/** Orquestación con cliente OpenAI del proyecto. */
export async function runLegalAnalysisWithOpenAi(
  openai: OpenAI,
  rawRequest: unknown,
  modelName?: string,
): Promise<{
  analysis: LegalAnalysisResult;
  lengthOk: boolean;
  promptVersion: string;
}> {
  const model = createOpenAiModelClient(openai, {
    model: modelName,
    jsonSchema: {
      name: 'analisis_radicacion',
      schema: OPENAI_LEGAL_SCHEMA as unknown as Record<string, unknown>,
    },
  });
  return runLegalAnalysis(rawRequest, model);
}
