import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOpenAiTlsInsecureFetch } from './openai-insecure-fetch';
import { judicialAttachmentPriority } from './parse-judicial-email';
import type { ParseSessionRow } from './parse-email-sessions';

export type EmailClasificacionTipo = 'reparto_nuevo' | 'respuesta_tramite' | 'impugnacion' | 'otro';
export type EmailClasificacionConfianza = 'alta' | 'media' | 'baja';

/** Resultado de vincular el correo con un expediente existente en el despacho. */
export type VinculoExpediente = 'encontrado' | 'no_encontrado' | 'ambiguo' | 'no_aplica';

export type CasoCandidato = {
  id: string;
  radicado: string;
  claimant: string;
  defendant: string;
  etapa_actual: string;
};

export type ClassifyJudicialEmailResult = {
  tipo: EmailClasificacionTipo;
  descripcion_breve: string;
  confianza: EmailClasificacionConfianza;
  radicado_referencia: string | null;
  accionante: string | null;
  accionado: string | null;
  casos_candidatos: CasoCandidato[];
  parseSessionId: string;
  vinculo_expediente: VinculoExpediente;
  /** Referencia de proceso extraída del correo (ej. 2026-00255). */
  referencia_proceso: string | null;
  /** Expediente único cuando vinculo_expediente === 'encontrado'. */
  expediente_vinculado_id: string | null;
  /** Tokens reportados por OpenAI (0 si no hubo llamada o falló). */
  usage?: { input_tokens: number; output_tokens: number; with_pdf: boolean };
};

type ClassifyParams = {
  subject: string;
  bodyText: string;
  attachments: ParseSessionRow[];
  /** Nombres de adjuntos sin descargar binarios (solo metadatos Graph). */
  attachmentNames?: string[];
  /** Descarga como máximo un PDF si el análisis de texto no alcanza. */
  fetchFirstPdf?: () => Promise<{ buffer: Buffer; filename: string } | null>;
  courtId: string;
  supabaseAdmin: SupabaseClient;
  parseSessionId: string;
};

type IaExtract = {
  tipo: EmailClasificacionTipo;
  radicado_referencia: string;
  todas_referencias: string[];
  accionante: string;
  accionado: string;
  descripcion_breve: string;
  confianza: EmailClasificacionConfianza;
};

const CLASIFICACION_SCHEMA = {
  type: 'object',
  properties: {
    tipo: {
      type: 'string',
      enum: ['reparto_nuevo', 'respuesta_tramite', 'impugnacion', 'otro'],
    },
    radicado_referencia: { type: 'string' },
    todas_referencias: { type: 'array', items: { type: 'string' } },
    accionante: { type: 'string' },
    accionado: { type: 'string' },
    descripcion_breve: { type: 'string' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: [
    'tipo',
    'radicado_referencia',
    'todas_referencias',
    'accionante',
    'accionado',
    'descripcion_breve',
    'confianza',
  ],
  additionalProperties: false,
} as const;

const IA_TIMEOUT_MS = 12_000;
const PDF_MAX_BYTES = 8 * 1024 * 1024;

function createOpenAiForClassify(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada.');
  const insecure = ['1', 'true', 'yes'].includes(String(process.env.OPENAI_TLS_INSECURE || '').toLowerCase());
  if (insecure) {
    return new OpenAI({ apiKey, fetch: createOpenAiTlsInsecureFetch() });
  }
  return new OpenAI({ apiKey });
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function nullIfEmpty(s: string | undefined | null): string | null {
  const t = String(s ?? '').trim();
  return t ? t : null;
}

export function extractReferencesHeuristic(subject: string, bodyText: string): string[] {
  const combined = `${subject}\n${bodyText}`;
  const found = new Set<string>();
  const patterns = [
    /\b\d{23}\b/g,
    /\b20\d{2}[-/.]\d{2,8}(?:[-/.]\d{2,4})?\b/gi,
    /\btutela\s+20\d{2}[-\s]?\d{2,6}\b/gi,
    /\brad\.?\s*20\d{2}[-\s]?\d{2,6}/gi,
    /(?:no\.?|n[úu]m\.?|nro\.?)\s*(?:de\s+)?proceso\s*[:#]?\s*20\d{2}[-\s/.\d]*/gi,
    /\bproceso\s+20\d{2}[-\s]?\d{2,6}/gi,
  ];
  for (const re of patterns) {
    for (const m of combined.matchAll(re)) {
      const s = String(m[0]).trim();
      if (s.length >= 4) found.add(s);
    }
  }
  return [...found];
}

export function referenciaProcesoPrincipal(
  extract: Pick<IaExtract, 'radicado_referencia' | 'todas_referencias'>,
  subject: string,
  bodyText: string
): string | null {
  const refs = [
    extract.radicado_referencia,
    ...extract.todas_referencias,
    ...extractReferencesHeuristic(subject, bodyText),
  ]
    .map((r) => String(r).trim())
    .filter(Boolean);
  const unique = [...new Set(refs)];
  const internal = unique.find((r) => /\b20\d{2}[-/.\s]\d{2,6}/i.test(r));
  if (internal) return internal;
  const national = unique.find((r) => digitsOnly(r).length === 23);
  if (national) return national;
  return unique[0] ?? null;
}

export function requiereVinculoExpediente(tipo: EmailClasificacionTipo): boolean {
  return tipo === 'respuesta_tramite' || tipo === 'impugnacion';
}

export function resolveVinculoExpediente(opts: {
  tipo: EmailClasificacionTipo;
  referenciaProceso: string | null;
  casos_candidatos: CasoCandidato[];
  confianza: EmailClasificacionConfianza;
}): {
  vinculo: VinculoExpediente;
  expediente_vinculado_id: string | null;
} {
  const { tipo, referenciaProceso, casos_candidatos, confianza } = opts;
  const n = casos_candidatos.length;

  if (!requiereVinculoExpediente(tipo)) {
    return { vinculo: 'no_aplica', expediente_vinculado_id: null };
  }

  if (n === 1) {
    return { vinculo: 'encontrado', expediente_vinculado_id: casos_candidatos[0].id };
  }

  if (n > 1) {
    if (confianza === 'alta' && referenciaProceso) {
      return { vinculo: 'encontrado', expediente_vinculado_id: casos_candidatos[0].id };
    }
    return { vinculo: 'ambiguo', expediente_vinculado_id: null };
  }

  if (referenciaProceso) {
    return { vinculo: 'no_encontrado', expediente_vinculado_id: null };
  }

  return { vinculo: 'no_encontrado', expediente_vinculado_id: null };
}

function parseYearSeq(ref: string): { year: string; seq: string } | null {
  const m = ref.match(/\b(20\d{2})[-/.\s]?(\d{2,8})/i);
  if (!m) return null;
  const seq = m[2].replace(/\D/g, '');
  if (!seq) return null;
  return { year: m[1], seq };
}

function hasClearRadicadoReference(subject: string, bodyText: string, refs: string[]): boolean {
  if (refs.some((r) => digitsOnly(r).length >= 23)) return true;
  const combined = `${subject}\n${bodyText}`;
  if (/\d{4}[-/.\s]\d{2,8}/.test(combined)) return true;
  if (/\b(?:RV|RE|REF)[:\s]/i.test(subject)) return true;
  if (/\b20\d{2}[-/.\s]\d{2,6}\b/i.test(combined)) return true;
  if (/\btutela\b/i.test(combined) && /\b20\d{2}\b/.test(combined)) return true;
  return false;
}

function pickPdfFromAttachments(attachments: ParseSessionRow[]): { buffer: Buffer; filename: string } | null {
  const pdfs = attachments
    .filter((a) => {
      const ct = (a.contentType || '').toLowerCase();
      return ct === 'application/pdf' || String(a.filename || '').toLowerCase().endsWith('.pdf');
    })
    .filter((a) => a.buffer.length > 0 && a.buffer.length <= PDF_MAX_BYTES)
    .sort((a, b) => {
      const pA = judicialAttachmentPriority(String(a.filename || ''));
      const pB = judicialAttachmentPriority(String(b.filename || ''));
      if (pA !== pB) return pA - pB;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  if (!pdfs.length) return null;
  const top = pdfs[0];
  return { buffer: top.buffer, filename: String(top.filename || 'adjunto.pdf') };
}

function needsPdfPass(
  subject: string,
  bodyText: string,
  extract: IaExtract
): boolean {
  const refs = [
    ...extract.todas_referencias,
    extract.radicado_referencia,
    ...extractReferencesHeuristic(subject, bodyText),
  ];
  if (hasClearRadicadoReference(subject, bodyText, refs)) return false;
  if (extract.confianza === 'alta' && extract.tipo !== 'otro') return false;
  return true;
}

function buildClassifyPrompt(subject: string, bodySlice: string, attachmentNames: string[]): string {
  return `Eres asistente de un juzgado de tutela en Colombia. Clasifica el correo judicial entrante.

Ejemplos de tipo:
- respuesta_tramite: "RV: RESPUESTA", "adjunta respuesta al auto", entidad (EPS, CNSC, etc.) contestando un requerimiento o trámite.
- impugnacion: "impugna el fallo", "recurso de reposición", "inconforme con la decisión".
- reparto_nuevo: acta de reparto, demanda inicial, reparto judicial, tutela nueva.
- otro: administrativo, spam, sin trámite judicial claro.

Extrae TODAS las referencias numéricas visibles: radicado nacional (23 dígitos), referencias internas del despacho (ej. 2026-00255, 2026-255, RAD. 2026-00255-00) y menciones en asunto tipo "tutela 2026-255".
No exijas 23 dígitos: con año + consecutivo interno basta para radicado_referencia.
En radicado_referencia pon la referencia principal más relevante para vincular expediente, o cadena vacía si no hay.

Asunto: ${subject || '(sin asunto)'}

Cuerpo (extracto):
${bodySlice}

Adjuntos: ${attachmentNames.length ? attachmentNames.join(', ') : '(ninguno)'}`;
}

async function extractWithOpenAi(
  subject: string,
  bodyText: string,
  attachmentNames: string[],
  pdfPick: { buffer: Buffer; filename: string } | null
): Promise<{ extract: IaExtract; usage: { input_tokens: number; output_tokens: number; with_pdf: boolean } } | null> {
  const bodySlice = bodyText.slice(0, 3500);
  const prompt = buildClassifyPrompt(subject, bodySlice, attachmentNames);

  const openai = createOpenAiForClassify();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IA_TIMEOUT_MS);

  try {
    const content: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_file'; filename: string; file_data: string }
    > = [{ type: 'input_text', text: prompt }];

    if (pdfPick) {
      content.push({
        type: 'input_file',
        filename: pdfPick.filename.endsWith('.pdf') ? pdfPick.filename : `${pdfPick.filename}.pdf`,
        file_data: `data:application/pdf;base64,${pdfPick.buffer.toString('base64')}`,
      });
    }

    const res = await openai.responses.create(
      {
        model,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'clasificacion_correo',
            schema: CLASIFICACION_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        },
      },
      { signal: controller.signal }
    );

    const raw = JSON.parse(res.output_text || '{}') as IaExtract;
    const usage = res.usage;
    return {
      extract: {
        tipo: raw.tipo || 'otro',
        radicado_referencia: String(raw.radicado_referencia ?? ''),
        todas_referencias: Array.isArray(raw.todas_referencias)
          ? raw.todas_referencias.map(String).filter(Boolean)
          : [],
        accionante: String(raw.accionante ?? ''),
        accionado: String(raw.accionado ?? ''),
        descripcion_breve: String(raw.descripcion_breve ?? '').trim() || 'Correo judicial',
        confianza: raw.confianza || 'baja',
      },
      usage: {
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        with_pdf: Boolean(pdfPick),
      },
    };
  } catch (e) {
    console.warn('[classify-judicial-email] OpenAI:', (e as Error)?.message || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type CaseRow = {
  id: string;
  radicado: string | null;
  claimant: string | null;
  defendant: string | null;
  status: string | null;
  origin_radicado: string | null;
};

async function loadEtapaByCaseIds(
  admin: SupabaseClient,
  caseIds: string[]
): Promise<Map<string, string>> {
  if (!caseIds.length) return new Map();
  const { data, error } = await admin
    .from('case_stages')
    .select('case_id, stage_code')
    .in('case_id', caseIds)
    .is('exited_at', null);
  if (error) {
    console.warn('[classify-judicial-email] case_stages:', error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const cid = String((row as { case_id?: string }).case_id ?? '');
    const code = String((row as { stage_code?: string }).stage_code ?? '');
    if (cid && code) map.set(cid, code);
  }
  return map;
}

function toCandidato(row: CaseRow, etapaMap: Map<string, string>): CasoCandidato {
  const id = String(row.id);
  return {
    id,
    radicado: String(row.radicado ?? ''),
    claimant: String(row.claimant ?? ''),
    defendant: String(row.defendant ?? ''),
    etapa_actual: etapaMap.get(id) || String(row.status ?? '—'),
  };
}

async function matchExpedientes(
  admin: SupabaseClient,
  courtId: string,
  extract: IaExtract
): Promise<CasoCandidato[]> {
  const seen = new Set<string>();
  const ordered: CaseRow[] = [];

  const addRows = (rows: CaseRow[] | null | undefined) => {
    for (const row of rows ?? []) {
      const id = String(row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ordered.push(row);
      if (ordered.length >= 3) return true;
    }
    return ordered.length >= 3;
  };

  const refs = [
    ...extract.todas_referencias,
    extract.radicado_referencia,
  ]
    .map((r) => String(r).trim())
    .filter(Boolean);

  const uniqueRefs = [...new Set(refs)];

  for (const ref of uniqueRefs) {
    const digits = digitsOnly(ref);
    if (digits.length === 23) {
      const { data } = await admin
        .from('cases')
        .select('id, radicado, claimant, defendant, status, origin_radicado')
        .eq('court_id', courtId)
        .eq('radicado', digits)
        .limit(3);
      if (addRows(data as CaseRow[] | null)) break;
    }
  }

  if (ordered.length < 3) {
    for (const ref of uniqueRefs) {
      const fragment = ref.replace(/[%_\\]/g, '').trim();
      if (fragment.length < 4) continue;
      const { data } = await admin
        .from('cases')
        .select('id, radicado, claimant, defendant, status, origin_radicado')
        .eq('court_id', courtId)
        .ilike('origin_radicado', `%${fragment}%`)
        .limit(5);
      if (addRows(data as CaseRow[] | null)) break;
    }
  }

  if (ordered.length < 3) {
    for (const ref of uniqueRefs) {
      const ys = parseYearSeq(ref);
      if (!ys) continue;
      const { year, seq } = ys;
      const proceso5 = seq.padStart(5, '0').slice(-5);
      const needleRadicado = `${year}${proceso5}`;

      const { data: byOrigin } = await admin
        .from('cases')
        .select('id, radicado, claimant, defendant, status, origin_radicado')
        .eq('court_id', courtId)
        .ilike('origin_radicado', `%${year}%${seq}%`)
        .limit(5);
      if (addRows(byOrigin as CaseRow[] | null)) break;

      const { data: byRadProceso } = await admin
        .from('cases')
        .select('id, radicado, claimant, defendant, status, origin_radicado')
        .eq('court_id', courtId)
        .ilike('radicado', `%${needleRadicado}%`)
        .limit(5);
      if (addRows(byRadProceso as CaseRow[] | null)) break;

      const fragment = ref.replace(/[%_\\]/g, '').trim();
      if (fragment.length >= 4) {
        const { data: byOriginFrag } = await admin
          .from('cases')
          .select('id, radicado, claimant, defendant, status, origin_radicado')
          .eq('court_id', courtId)
          .ilike('origin_radicado', `%${fragment}%`)
          .limit(5);
        if (addRows(byOriginFrag as CaseRow[] | null)) break;
      }
    }
  }

  const accionante = nullIfEmpty(extract.accionante);
  const accionado = nullIfEmpty(extract.accionado);

  if (ordered.length < 3 && accionante && accionante.length >= 4) {
    const { data } = await admin
      .from('cases')
      .select('id, radicado, claimant, defendant, status, origin_radicado')
      .eq('court_id', courtId)
      .ilike('claimant', `%${accionante.slice(0, 80)}%`)
      .limit(5);
    addRows(data as CaseRow[] | null);
  }

  if (ordered.length < 3 && accionado && accionado.length >= 4) {
    const { data } = await admin
      .from('cases')
      .select('id, radicado, claimant, defendant, status, origin_radicado')
      .eq('court_id', courtId)
      .ilike('defendant', `%${accionado.slice(0, 80)}%`)
      .limit(5);
    addRows(data as CaseRow[] | null);
  }

  const top = ordered.slice(0, 3);
  const etapaMap = await loadEtapaByCaseIds(
    admin,
    top.map((r) => String(r.id))
  );
  return top.map((r) => toCandidato(r, etapaMap));
}

function fallbackResult(parseSessionId: string): ClassifyJudicialEmailResult {
  return {
    tipo: 'otro',
    descripcion_breve: 'No se pudo clasificar automáticamente.',
    confianza: 'baja',
    radicado_referencia: null,
    accionante: null,
    accionado: null,
    casos_candidatos: [],
    parseSessionId,
    vinculo_expediente: 'no_aplica',
    referencia_proceso: null,
    expediente_vinculado_id: null,
    usage: { input_tokens: 0, output_tokens: 0, with_pdf: false },
  };
}

export async function classifyJudicialEmail(params: ClassifyParams): Promise<ClassifyJudicialEmailResult> {
  const {
    subject,
    bodyText,
    attachments,
    attachmentNames: namesParam,
    fetchFirstPdf,
    courtId,
    supabaseAdmin,
    parseSessionId,
  } = params;

  const attachmentNames =
    namesParam?.length ? namesParam : attachments.map((a) => a.filename || a.originalName || 'adjunto');

  let ia = await extractWithOpenAi(subject, bodyText, attachmentNames, null);
  if (!ia) {
    return fallbackResult(parseSessionId);
  }

  let { extract, usage } = ia;

  if (needsPdfPass(subject, bodyText, extract)) {
    const fromSession = pickPdfFromAttachments(attachments);
    const pdf =
      fromSession ||
      (fetchFirstPdf ? await fetchFirstPdf() : null);
    if (pdf) {
      const ia2 = await extractWithOpenAi(subject, bodyText, attachmentNames, pdf);
      if (ia2) {
        extract = ia2.extract;
        usage = {
          input_tokens: usage.input_tokens + ia2.usage.input_tokens,
          output_tokens: usage.output_tokens + ia2.usage.output_tokens,
          with_pdf: true,
        };
      }
    }
  }

  const heuristicRefs = extractReferencesHeuristic(subject, bodyText);
  extract = {
    ...extract,
    todas_referencias: [
      ...new Set([...extract.todas_referencias, ...heuristicRefs]),
    ],
    radicado_referencia:
      extract.radicado_referencia ||
      heuristicRefs[0] ||
      '',
  };

  const casos_candidatos = await matchExpedientes(supabaseAdmin, courtId, extract);
  const referencia_proceso = referenciaProcesoPrincipal(extract, subject, bodyText);
  const { vinculo, expediente_vinculado_id } = resolveVinculoExpediente({
    tipo: extract.tipo,
    referenciaProceso: referencia_proceso,
    casos_candidatos,
    confianza: extract.confianza,
  });

  return {
    tipo: extract.tipo,
    descripcion_breve: extract.descripcion_breve,
    confianza: extract.confianza,
    radicado_referencia: nullIfEmpty(extract.radicado_referencia),
    accionante: nullIfEmpty(extract.accionante),
    accionado: nullIfEmpty(extract.accionado),
    casos_candidatos,
    parseSessionId,
    vinculo_expediente: vinculo,
    referencia_proceso,
    expediente_vinculado_id,
    usage,
  };
}
