import type { JSONContent } from '@tiptap/core';

const PREFIX = 'tiptap:';

export function isTiptapStorage(raw: string): boolean {
  return raw.trimStart().startsWith(PREFIX);
}

/** Contenido guardado en BD → documento TipTap. */
export function parseStorageToDoc(raw: string): JSONContent {
  const t = raw.trim();
  if (t.startsWith(PREFIX)) {
    try {
      const json = JSON.parse(t.slice(PREFIX.length)) as JSONContent;
      if (json?.type === 'doc') return normalizeMarcadoresTextoEnDoc(json);
    } catch {
      /* fallthrough */
    }
  }
  return normalizeMarcadoresTextoEnDoc(plainTextToTiptapDoc(t));
}

/** Documento TipTap → cadena para guardar en BD. */
export function docToStorage(doc: JSONContent): string {
  return PREFIX + JSON.stringify(doc);
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

function lineToInlineNodes(line: string): JSONContent[] {
  const parts: JSONContent[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', text: line.slice(last, m.index) });
    }
    parts.push({
      type: 'expedienteVariable',
      attrs: { key: m[1].trim() },
    });
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    parts.push({ type: 'text', text: line.slice(last) });
  }
  if (parts.length === 0) {
    parts.push({ type: 'text', text: '' });
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
