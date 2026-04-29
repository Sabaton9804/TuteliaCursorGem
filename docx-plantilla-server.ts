/**
 * Solo servidor (importado desde server.ts): lectura de .docx, sustitución de literales por marcadores, llamadas a IA.
 * PizZip se carga con import() dinámico solo al procesar .docx.
 */
import OpenAI from 'openai';

export type MapeoLiteralMarcador = { original: string; marcador: string };

const MAX_TEXTO_IA = 120_000;

async function loadPizZip() {
  const { default: PizZip } = await import('pizzip');
  return PizZip;
}

type ZipInstance = InstanceType<Awaited<ReturnType<typeof loadPizZip>>>;

function decodeXmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function encodeXmlText(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Une runs <w:t> consecutivos para facilitar reemplazos literales. */
function mergeAdjacentWt(xml: string): string {
  let out = xml;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 5000) {
    changed = false;
    const next = out.replace(
      /<w:t([^>]*)>([\s\S]*?)<\/w:t>(\s*)<w:t([^>]*)>([\s\S]*?)<\/w:t>/g,
      (_full, a1, t1, sp, _a2, t2) => {
        changed = true;
        return `<w:t${a1}>${t1}${t2}</w:t>${sp}`;
      },
    );
    out = next;
  }
  return out;
}

function listWordXmlPaths(zip: ZipInstance): string[] {
  return Object.keys(zip.files).filter((k) => {
    if (zip.files[k].dir) return false;
    return (
      k === 'word/document.xml' ||
      k === 'word/footnotes.xml' ||
      /^word\/header\d+\.xml$/.test(k) ||
      /^word\/footer\d+\.xml$/.test(k)
    );
  });
}

export async function extraerTextoPlanoDocx(buffer: Buffer): Promise<string> {
  const PizZip = await loadPizZip();
  const zip = new PizZip(buffer) as ZipInstance;
  const chunks: string[] = [];
  for (const path of listWordXmlPaths(zip)) {
    const xml = zip.files[path].asText();
    const parts: string[] = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      parts.push(decodeXmlText(m[1]));
    }
    if (parts.length) chunks.push(parts.join(''));
  }
  return chunks.join('\n\n');
}

export async function aplicarMapeoEnDocx(buffer: Buffer, mappings: MapeoLiteralMarcador[]): Promise<Buffer> {
  const PizZip = await loadPizZip();
  const zip = new PizZip(buffer) as ZipInstance;
  const sorted = [...mappings].filter((x) => x.original.trim()).sort((a, b) => b.original.length - a.original.length);

  for (const path of listWordXmlPaths(zip)) {
    let xml = zip.files[path].asText();
    xml = mergeAdjacentWt(xml);
    for (const { original, marcador } of sorted) {
      const tag = `{{${marcador}}}`;
      const enc = encodeXmlText(original);
      const tagXml = tag.replace(/&/g, '&amp;');
      if (xml.includes(enc)) {
        xml = xml.split(enc).join(tagXml);
      }
    }
    zip.file(path, xml);
  }

  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return Buffer.from(out);
}

function parseMappingsJson(raw: string): MapeoLiteralMarcador[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error('La IA no devolvió JSON válido. Intente de nuevo o reduzca el documento.');
  }
  let arr: unknown[];
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    const o = data as { mappings?: unknown; items?: unknown };
    if (Array.isArray(o.mappings)) arr = o.mappings;
    else if (Array.isArray(o.items)) arr = o.items;
    else throw new Error('Formato JSON inesperado: se esperaba un array o { mappings: [...] }.');
  } else {
    throw new Error('Formato JSON inesperado: se esperaba un array o { mappings: [...] }.');
  }
  const out: MapeoLiteralMarcador[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const o = row as { original?: unknown; marcador?: unknown };
    const original = typeof o.original === 'string' ? o.original : '';
    const marcador = typeof o.marcador === 'string' ? o.marcador.trim() : '';
    if (original && marcador) out.push({ original, marcador });
  }
  return out;
}

const PROMPT_ANALISIS = `Este es el texto de un auto judicial colombiano (puede incluir informes u otros documentos del mismo expediente). Identifica todos los fragmentos que son datos variables (que cambiarían en cada expediente): nombres de personas, números de radicación, fechas, entidades, derechos tutelados, resúmenes de hechos, etc.

Devuelve SOLO un JSON con este formato (array):
[{"original": "texto exacto como aparece", "marcador": "CLAVE_CATALOGO"}, ...]

Use como «marcador» únicamente claves del catálogo permitido que le paso abajo (copie la ortografía exacta, incluidos espacios si figuran en el catálogo). Si un dato no encaja claramente, elija la clave más cercana del catálogo.

Sin explicaciones, sin markdown, solo el JSON array.

CATÁLOGO DE MARCADORES PERMITIDOS (elija el más adecuado por fila):
`;

function getOpenAiForPlantilla(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Configure OPENAI_API_KEY para la detección automática de variables en el servidor (.env).',
    );
  }
  return new OpenAI({ apiKey });
}

export async function analizarVariablesDocxConIa(
  textoPlano: string,
  catalogoDescripcion: string,
): Promise<MapeoLiteralMarcador[]> {
  const slice = textoPlano.length > MAX_TEXTO_IA ? textoPlano.slice(0, MAX_TEXTO_IA) : textoPlano;
  const userContent = `${PROMPT_ANALISIS}

${catalogoDescripcion}

---

TEXTO DEL DOCUMENTO:

${slice}
${textoPlano.length > MAX_TEXTO_IA ? '\n\n[Texto truncado para el análisis — el archivo completo se procesará al aplicar marcadores.]' : ''}`;

  const openai = getOpenAiForPlantilla();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content:
          userContent +
          '\n\nResponda únicamente con un objeto JSON: {"mappings":[{"original":"...","marcador":"..."}, ...]}.',
      },
    ],
    response_format: { type: 'json_object' },
  });
  const text = completion.choices[0]?.message?.content ?? '';
  return parseMappingsJson(text);
}

export function simularVistaPreviaTexto(texto: string, mappings: MapeoLiteralMarcador[]): string {
  let s = texto;
  const sorted = [...mappings].filter((x) => x.original.trim()).sort((a, b) => b.original.length - a.original.length);
  for (const { original, marcador } of sorted) {
    const tag = `{{${marcador}}}`;
    if (s.includes(original)) s = s.split(original).join(tag);
  }
  return s;
}
