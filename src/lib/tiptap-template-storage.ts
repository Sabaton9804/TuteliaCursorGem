import type { JSONContent } from '@tiptap/core';

const PREFIX = 'tiptap:';

export function isTiptapStorage(raw: string): boolean {
  return raw.trimStart().startsWith(PREFIX);
}

/**
 * TipTap rechaza nodos `{ type: 'text', text: '' }` (RangeError: Empty text nodes are not allowed).
 * Limpia recursivamente; si el doc queda sin bloques, deja un párrafo vacío válido.
 */
function isDisallowedEmptyTextNode(ch: JSONContent): boolean {
  if (ch.type !== 'text') return false;
  const t = ch.text;
  return t == null || t === '';
}

export function removeEmptyTextNodesFromTipTapDoc(node: JSONContent): JSONContent {
  if (node.content?.length) {
    const processed = node.content
      .map(removeEmptyTextNodesFromTipTapDoc)
      .filter((ch) => !isDisallowedEmptyTextNode(ch));
    if (node.type === 'doc' && processed.length === 0) {
      return { type: 'doc', content: [{ type: 'paragraph' }] };
    }
    return { ...node, content: processed };
  }
  return node;
}

function textoPlanoParrafoInforme(node: JSONContent): string {
  if (node.type !== 'paragraph' || !node.content?.length) return '';
  let s = '';
  for (const ch of node.content) {
    if (ch.type === 'text') s += ch.text ?? '';
    else if (ch.type === 'expedienteVariable') s += `{{${String(ch.attrs?.key ?? '').trim()}}}`;
  }
  return s.trim();
}

/** Inicio del párrafo sustancial del informe (alineado con `MARCA_CUERPO_INFORME` en plantilla-variables). */
const PREFIJO_CUERPO_INFORME = /^En la fecha ingresa al Despacho del señor juez/i;

/**
 * Solo si el párrafo del cuerpo no tiene `textAlign` guardado: aplica justificado (Word típico).
 * No sustituye centro/izquierda/derecha ya definidos en la plantilla.
 */
export function defectoJustifyCuerpoInformeEnDoc(doc: JSONContent): JSONContent {
  if (doc.type !== 'doc' || !doc.content?.length) return doc;
  return {
    ...doc,
    content: doc.content.map((block) => {
      if (block.type !== 'paragraph') return block;
      const plain = textoPlanoParrafoInforme(block);
      if (!PREFIJO_CUERPO_INFORME.test(plain)) return block;
      const cur = (block.attrs as { textAlign?: string | null } | undefined)?.textAlign;
      if (cur != null && String(cur).trim() !== '') return block;
      return { ...block, attrs: { ...(block.attrs ?? {}), textAlign: 'justify' as const } };
    }),
  };
}

export type ParseStorageOptions = {
  /**
   * Informe de ingreso: si el párrafo del cuerpo («En la fecha…») no trae `textAlign` en el JSON,
   * aplica justificado por defecto (plantilla Word típica). No pisa centro/izquierda/derecha guardados.
   */
  informeCuerpoJustifyDefecto?: boolean;
};

/** Contenido guardado en BD → documento TipTap. */
export function parseStorageToDoc(raw: string, opts?: ParseStorageOptions): JSONContent {
  const t = raw.trim();
  let doc: JSONContent;
  if (t.startsWith(PREFIX)) {
    try {
      const json = JSON.parse(t.slice(PREFIX.length)) as JSONContent;
      if (json?.type === 'doc') {
        doc = removeEmptyTextNodesFromTipTapDoc(normalizeMarcadoresTextoEnDoc(json));
      } else {
        doc = removeEmptyTextNodesFromTipTapDoc(normalizeMarcadoresTextoEnDoc(plainTextToTiptapDoc(t)));
      }
    } catch {
      doc = removeEmptyTextNodesFromTipTapDoc(normalizeMarcadoresTextoEnDoc(plainTextToTiptapDoc(t)));
    }
  } else {
    doc = removeEmptyTextNodesFromTipTapDoc(normalizeMarcadoresTextoEnDoc(plainTextToTiptapDoc(t)));
  }
  if (opts?.informeCuerpoJustifyDefecto) {
    doc = defectoJustifyCuerpoInformeEnDoc(doc);
  }
  return doc;
}

/** Documento TipTap → cadena para guardar en BD. */
export function docToStorage(doc: JSONContent): string {
  return PREFIX + JSON.stringify(removeEmptyTextNodesFromTipTapDoc(doc));
}

/** Texto plano con {{ }} → doc inicial (plantillas legacy). */
export function plainTextToTiptapDoc(plain: string): JSONContent {
  const lines = plain.split(/\r?\n/);
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: lineToInlineNodes(line),
    })),
  };
}

const BOLD_MARK = { type: 'bold' } as const;

function inlineNodesConNegrita(line: string): JSONContent[] {
  return lineToInlineNodes(line).map((n) => {
    if (n.type !== 'text') return n;
    const marks = n.marks ?? [];
    if (marks.some((m) => m.type === 'bold')) return n;
    return { ...n, marks: [...marks, BOLD_MARK] };
  });
}

/** Prefijo membrete rico: título + ciudad/fecha centrados y en negrita (variables conservadas). */
export function informeTituloFechaPrefijoTiptapDoc(): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [{ type: 'text', text: 'INFORME DE INGRESO AL DESPACHO', marks: [BOLD_MARK] }],
      },
      { type: 'paragraph' },
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: inlineNodesConNegrita('{{CIUDAD}}, {{FECHA_LETRAS_COMPLETA}}'),
      },
      { type: 'paragraph' },
    ],
  };
}

function parrafoConCentroYNegrita(block: JSONContent): JSONContent {
  if (block.type !== 'paragraph') return block;
  const attrs = { ...(block.attrs ?? {}), textAlign: 'center' as const };
  if (!block.content?.length) return { ...block, attrs };
  const content = block.content.map((ch) => {
    if (ch.type === 'text') {
      const marks = [...(ch.marks ?? [])];
      if (!marks.some((m) => m.type === 'bold')) marks.push(BOLD_MARK);
      return { ...ch, marks };
    }
    return ch;
  });
  return { ...block, attrs, content };
}

/**
 * Ajusta párrafos típicos del informe (título, fecha, firma) aunque el JSON en BD venga sin atributos.
 * La alineación del cuerpo («En la fecha…») respeta la plantilla; si no hay `textAlign`, se aplica justificado.
 */
export function aplicarEstiloInformeEncabezadoYFirmaTipTap(doc: JSONContent): JSONContent {
  if (doc.type !== 'doc' || !doc.content?.length) return doc;
  const MESES =
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i;
  const cordIdx = doc.content.findIndex((b) => {
    if (b.type !== 'paragraph') return false;
    return /^Cordialmente/i.test(textoPlanoParrafoInforme(b));
  });
  const next = doc.content.map((block, i) => {
    if (block.type !== 'paragraph') return block;
    const plain = textoPlanoParrafoInforme(block);
    if (/^INFORME DE INGRESO AL DESPACHO$/i.test(plain)) {
      return parrafoConCentroYNegrita(block);
    }
    if (/^Bogotá/i.test(plain) && MESES.test(plain)) {
      return parrafoConCentroYNegrita(block);
    }
    if (cordIdx >= 0 && i > cordIdx && plain.length > 0 && !/^Cordialmente/i.test(plain)) {
      const cuerpoLargo = PREFIJO_CUERPO_INFORME.test(plain) || plain.length > 220;
      if (!cuerpoLargo) return parrafoConCentroYNegrita(block);
    }
    return block;
  });
  return defectoJustifyCuerpoInformeEnDoc({ ...doc, content: next });
}

function lineToInlineNodes(line: string): JSONContent[] {
  const parts: JSONContent[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      const slice = line.slice(last, m.index);
      if (slice) parts.push({ type: 'text', text: slice });
    }
    parts.push({
      type: 'expedienteVariable',
      attrs: { key: m[1].trim() },
    });
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    const slice = line.slice(last);
    if (slice) parts.push({ type: 'text', text: slice });
  }
  return parts;
}

/** Si el JSON guardado tiene `{{CLAVE}}` como texto plano (copiar/pegar o plantilla antigua), convierte a nodos `expedienteVariable` para que el editor muestre pastillas moradas. */
export function normalizeMarcadoresTextoEnDoc(node: JSONContent): JSONContent {
  if (!node.content?.length) return node;
  const next: JSONContent[] = [];
  for (const child of node.content) {
    if (child.type === 'text' && typeof child.text === 'string' && /\{\{[^}]+\}\}/.test(child.text)) {
      next.push(...lineToInlineNodes(child.text));
    } else {
      next.push(normalizeMarcadoresTextoEnDoc(child));
    }
  }
  return { ...node, content: next };
}

function inlineToPlain(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'expedienteVariable') return `{{${String(node.attrs?.key ?? '').trim()}}}`;
  return '';
}

/** Convierte bloque a texto plano (sustitución de variables, Word desde código). */
export function jsonDocToSubstitutionPlain(node: JSONContent | undefined): string {
  if (!node) return '';
  switch (node.type) {
    case 'doc':
      return node.content?.map(jsonDocToSubstitutionPlain).join('') ?? '';
    case 'paragraph':
      return (node.content?.map(inlineToPlain).join('') ?? '') + '\n';
    case 'heading':
      return (node.content?.map(inlineToPlain).join('') ?? '') + '\n\n';
    case 'bulletList':
    case 'orderedList':
      return node.content?.map(jsonDocToSubstitutionPlain).join('') ?? '';
    case 'listItem': {
      const chunks: string[] = [];
      for (const c of node.content ?? []) {
        if (c.type === 'paragraph') {
          chunks.push(c.content?.map(inlineToPlain).join('') ?? '');
        } else {
          chunks.push(jsonDocToSubstitutionPlain(c).replace(/\n+$/, ''));
        }
      }
      return `• ${chunks.join(' ')}\n`;
    }
    case 'table':
      return `\n${node.content?.map(jsonDocToSubstitutionPlain).join('') ?? ''}\n`;
    case 'tableRow': {
      const cells =
        node.content?.map((cell) => jsonDocToSubstitutionPlain(cell).replace(/\s*\n+\s*/g, ' ').trim()) ?? [];
      return `| ${cells.join(' | ')} |\n`;
    }
    case 'tableCell':
    case 'tableHeader':
      return node.content?.map(jsonDocToSubstitutionPlain).join('') ?? '';
    case 'text':
      return node.text ?? '';
    case 'hardBreak':
      return '\n';
    default:
      if (node.content) return node.content.map(jsonDocToSubstitutionPlain).join('');
      return '';
  }
}

/**
 * Si `contenido_base` es JSON TipTap (`tiptap:{...}` o JSON de documento con `type: "doc"`),
 * devuelve el árbol; si no, `null` (contenido legacy en texto plano).
 */
export function tryParseTipTapDocFromContenidoBase(raw: string | null | undefined): JSONContent | null {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (isTiptapStorage(s)) {
    try {
      const doc = JSON.parse(s.slice(PREFIX.length)) as JSONContent;
      if (doc?.type === 'doc') {
        return removeEmptyTextNodesFromTipTapDoc(normalizeMarcadoresTextoEnDoc(doc));
      }
    } catch {
      return null;
    }
    return null;
  }
  if (s.startsWith('{')) {
    try {
      const doc = JSON.parse(s) as JSONContent;
      if (doc?.type === 'doc') {
        return removeEmptyTextNodesFromTipTapDoc(normalizeMarcadoresTextoEnDoc(doc));
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Acepta valor BD (con prefijo tiptap: o texto plano) y devuelve texto con {{ }} para `sustituirMarcadores`. */
export function contenidoBaseToPlainForSubstitution(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (isTiptapStorage(s)) {
    try {
      const doc = JSON.parse(s.slice(PREFIX.length)) as JSONContent;
      return jsonDocToSubstitutionPlain(doc).replace(/\n+$/, '');
    } catch {
      return s;
    }
  }
  return s;
}
