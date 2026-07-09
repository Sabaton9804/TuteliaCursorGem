import type OpenAI from 'openai';

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

function isCivilCaseType(caseType: string | null | undefined): boolean {
  return String(caseType ?? '').startsWith('civil_');
}

function metaStr(meta: Record<string, unknown> | null | undefined, key: string): string {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

/** Texto principal que alimenta la IA cuando no hay demanda/correo (catálogo civil + SGDE). */
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
        metaStr(meta, 'situacion_plataforma') ? `Situación: ${metaStr(meta, 'situacion_plataforma')}` : null,
        metaStr(meta, 'etapa') ? `Etapa: ${metaStr(meta, 'etapa')}` : null,
        metaStr(meta, 'ubicacion_interna') ? `Ubicación interna: ${metaStr(meta, 'ubicacion_interna')}` : null,
        metaStr(meta, 'tramite_pendiente') ? `Trámite pendiente: ${metaStr(meta, 'tramite_pendiente')}` : null,
        metaStr(meta, 'encargado_nombre') ? `Encargado: ${metaStr(meta, 'encargado_nombre')}` : null,
        metaStr(meta, 'ultimo_auto_tipo')
          ? `Último auto: ${metaStr(meta, 'ultimo_auto_tipo')}${metaStr(meta, 'ultimo_auto_fecha') ? ` (${metaStr(meta, 'ultimo_auto_fecha')})` : ''}`
          : null,
        metaStr(meta, 'regimen') ? `Régimen: ${metaStr(meta, 'regimen')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (input.legalHechos?.trim()) parts.push(`HECHOS:\n${input.legalHechos.trim()}`);
  if (input.legalPretensiones?.trim()) parts.push(`PRETENSIONES:\n${input.legalPretensiones.trim()}`);
  if (input.legalDerechoTutelado?.trim()) parts.push(`DERECHO INVOCADO:\n${input.legalDerechoTutelado.trim()}`);

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
    input.deadlineAt?.trim() ? `Plazo registrado (deadline_at): ${input.deadlineAt.trim()}` : 'Plazo: no registrado.',
    input.assignedTo?.trim() || metaStr(meta, 'encargado_nombre')
      ? `Responsable: ${input.assignedTo?.trim() || metaStr(meta, 'encargado_nombre')}`
      : 'Responsable: sin asignación.',
    input.documentTitles?.length
      ? `Piezas (${input.documentTitles.length}): ${input.documentTitles.join(' · ')}`
      : 'Expediente digital: sin piezas listadas aún.',
  ];
  return lines.join('\n');
}

function synthesisPrompt(input: CaseSynthesisInput, rawText: string, contextBlock: string): string {
  const civil = isCivilCaseType(input.caseType) || input.catalogMetadata?.tipo_registro === 'civil';

  if (civil) {
    return `
Eres un asistente jurídico especializado en procesos civiles colombianos (CGP).
Sintetiza el estado del proceso para uso interno del despacho judicial. Sé concreto y operativo.

DEMANDANTE: ${input.claimant || 'No especificado'}
DEMANDADO: ${input.defendant || 'No especificado'}

### Datos del expediente en el sistema
${contextBlock.trim()}

### Información disponible del proceso
${rawText}

FORMATO DE SALIDA (MARKDOWN en español):
### Síntesis cognitiva operativa
**1. Tipo de proceso y objeto del litigio:** (breve)
**2. Partes y rol procesal:** (demandante / demandado y posición actual)
**3. Estado procesal:** (etapa, ubicación interna, trámite pendiente según datos)
**4. Actuación reciente:** (último auto o hito relevante; si no consta, indíquelo)
**5. Piezas y expediente:** (qué documentos hay y qué aportan al seguimiento)
**6. Términos y riesgos:** (plazos, emplazamientos, ejecutoria, etc.; si no consta: «No consta en los datos suministrados»)
**7. Seguimiento sugerido:** (1-3 acciones concretas para el despacho)
`;
  }

  return `
Eres un asistente juridico especializado en derecho constitucional colombiano.
Tu tarea es sintetizar los puntos clave de una demanda de tutela por urgencia y el estado procesal útil para el despacho.

REMITENTE/ACCIONANTE: ${input.claimant || 'No especificado'}

### Datos del expediente en el sistema (plazos, piezas, asignación)
${contextBlock.trim()}

CUERPO DEL CORREO/DEMANDA (texto principal):
${rawText}

FORMATO DE SALIDA (USAR MARKDOWN):
### Sintesis Operativa
**1. Derechos presuntamente vulnerados:** (Lista breve)
**2. Hechos relevantes:** (Maximo 3 puntos clave)
**3. Pretension principal:** (Sintesis de lo pedido)
**4. Urgencia detectada:** (Por que es urgente o si hay riesgo de dano irremediable)
**5. Plazos, traslados y contestaciones:** (A partir del bloque de expediente y del texto; si no consta indique «No consta en los datos suministrados»)
**6. Piezas y seguimiento:** (Relacione brevemente las piezas listadas con la controversia, si aplica)
`;
}

export async function generateCaseSynthesis(
  openai: OpenAI,
  input: CaseSynthesisInput,
  model?: string,
): Promise<string> {
  const rawText = buildCaseSynthesisRawText(input);
  if (!rawText.trim()) {
    throw new Error('Sin texto suficiente para generar síntesis');
  }
  const contextBlock = buildCaseSynthesisContextBlock(input);
  const prompt = synthesisPrompt(input, rawText, contextBlock);
  const m = (model || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

  const result = await openai.responses.create({
    model: m,
    input: prompt,
  });

  return (result.output_text || '').trim();
}
