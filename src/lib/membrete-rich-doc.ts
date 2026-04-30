import type { JSONContent } from '@tiptap/core';
import type { PlantillasMembrete } from './plantillas-store';

function docHasMeaningfulContent(doc: JSONContent | null): boolean {
  if (!doc?.content?.length) return false;
  for (const block of doc.content) {
    if (block.type === 'paragraph' || block.type === 'heading') {
      const inner = block.content;
      if (!inner?.length) continue;
      for (const n of inner) {
        if (n.type === 'text' && n.text?.trim()) return true;
        if (n.type === 'image' && (n.attrs as { src?: string })?.src?.trim()) return true;
      }
    }
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      if (docHasMeaningfulContent({ type: 'doc', content: block.content ?? [] })) return true;
    }
  }
  return false;
}

/**
 * El esquema TipTap exige imágenes inline dentro de párrafo; versiones anteriores
 * generaban un nodo `image` suelto (bloque) tras corregir JSON inválido, y el
 * centrado del párrafo no aplicaba al escudo.
 */
export function normalizeMembreteEditorDoc(doc: JSONContent): JSONContent {
  if (doc.type !== 'doc' || !doc.content?.length) return doc;
  const content: JSONContent[] = [];
  for (const node of doc.content) {
    if (node.type === 'image') {
      const attrs = { ...(node.attrs as Record<string, unknown> | undefined) };
      const align =
        typeof attrs.textAlign === 'string' && attrs.textAlign.trim()
          ? attrs.textAlign.trim()
          : 'center';
      delete attrs.textAlign;
      content.push({
        type: 'paragraph',
        attrs: { textAlign: align },
        content: [{ type: 'image', attrs }],
      });
    } else {
      content.push(node);
    }
  }
  return { ...doc, content };
}

/** Si hay documento TipTap guardado con texto o imagen (sustituye la vista fija del membrete). */
export function hasMembreteRichContent(m: PlantillasMembrete): boolean {
  const raw = m.membreteEditorJson?.trim();
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as JSONContent;
    if (parsed?.type !== 'doc') return false;
    const doc = normalizeMembreteEditorDoc(parsed);
    return docHasMeaningfulContent(doc);
  } catch {
    return false;
  }
}

export function parseMembreteEditorJson(raw: string | null | undefined): JSONContent | null {
  const t = raw?.trim();
  if (!t) return null;
  try {
    const doc = JSON.parse(t) as JSONContent;
    if (doc?.type === 'doc') return normalizeMembreteEditorDoc(doc);
    return null;
  } catch {
    return null;
  }
}

/** Documento inicial a partir de los campos clásicos (imagen + líneas + dirección + correo). */
export function defaultMembreteDocFromStruct(m: PlantillasMembrete): JSONContent {
  const content: JSONContent[] = [];
  const img = m.membreteImageDataUrl?.trim();
  if (img) {
    content.push({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'image', attrs: { src: img, alt: 'Membrete' } }],
    });
  }
  const lines = [m.auto.line1, m.auto.line2, m.auto.line3].filter((s) => s?.trim());
  for (const line of lines) {
    content.push({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: line.trim(), marks: [{ type: 'bold' }] }],
    });
  }
  if (m.informe.juzgado?.trim()) {
    content.push({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: m.informe.juzgado.trim() }],
    });
  }
  if (m.informe.direccion?.trim()) {
    content.push({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: m.informe.direccion.trim(), marks: [{ type: 'italic' }] }],
    });
  }
  if (m.informe.correo?.trim()) {
    content.push({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: `Correo: ${m.informe.correo.trim()}` }],
    });
  }
  if (content.length === 0) {
    content.push({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: 'Escriba aquí el membrete (texto e imágenes).' }],
    });
  }
  return { type: 'doc', content };
}
