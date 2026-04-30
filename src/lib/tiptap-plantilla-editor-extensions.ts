import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table/kit';
import type { Extensions } from '@tiptap/core';
import { ExpedienteVariable } from './tiptap-expediente-variable';
import { PlantillaToggleAttrs } from './tiptap-plantilla-toggle-attrs';

/**
 * Mismas extensiones que el cuerpo en `PlantillaInlineEditor`, para que el JSON guardado en
 * `document_templates.contenido_base` se renderice igual en el expediente (`TiptapTemplateEditor`).
 */
export function buildPlantillaBodyExtensions(
  resolveLabel: (key: string) => string,
  options?: { placeholder?: string },
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [3, 4] },
      /** StarterKit ya trae Underline; lo desactivamos aquí y registramos una sola instancia explícita (evita duplicados). */
      underline: false,
    }),
    Underline,
    TableKit.configure({
      table: {
        resizable: false,
        HTMLAttributes: { class: 'plantilla-tiptap-table' },
      },
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
    }),
    PlantillaToggleAttrs,
    ExpedienteVariable.configure({ resolveLabel }),
    Placeholder.configure({
      placeholder: options?.placeholder ?? 'Escriba el cuerpo del documento…',
    }),
  ];
}
