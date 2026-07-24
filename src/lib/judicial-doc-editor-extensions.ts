import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import type { Extensions } from '@tiptap/core';
import { ExpedienteVariable } from './tiptap-expediente-variable';
import { PlantillaToggleAttrs } from './tiptap-plantilla-toggle-attrs';
import { ReviewCommentMark } from './review-comment-mark';

export type BuildJudicialDocEditorExtensionsOptions = {
  /** Texto vacío / ayuda (plantilla y elaboración). */
  placeholder?: string;
  /** Variables `{{clave}}` y toggles de plantilla (plantilla + panel despacho). */
  plantillaNodes?: { resolveLabel: (key: string) => string };
  /** Marca `reviewComment` (revisión Word en Jurion). */
  showComments?: boolean;
};

/**
 * Misma base TipTap para plantillas, elaboración en expediente y revisión en Jurion.
 * Orden: marco de texto (`TextStyle`) antes de `Color` / `FontFamily` / `FontSize` (extensiones que lo amplían).
 */
export function buildJudicialDocEditorExtensions(
  opts: BuildJudicialDocEditorExtensionsOptions = {},
): Extensions {
  const exts: Extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      underline: false,
    }),
    Underline,
    TextStyle.configure({ mergeNestedSpanStyles: true }),
    Color,
    FontFamily,
    FontSize,
    TextAlign.configure({
      types: ['paragraph', 'heading', 'blockquote', 'tableCell', 'tableHeader'],
      defaultAlignment: 'justify',
    }),
    Table.configure({
      resizable: false,
      HTMLAttributes: { class: 'judicial-doc-table' },
    }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ allowBase64: true }),
  ];

  if (opts.placeholder?.trim()) {
    exts.push(
      Placeholder.configure({
        placeholder: opts.placeholder.trim(),
      }),
    );
  }

  if (opts.plantillaNodes) {
    const { resolveLabel } = opts.plantillaNodes;
    exts.push(
      PlantillaToggleAttrs,
      ExpedienteVariable.configure({ resolveLabel }),
    );
  }

  if (opts.showComments) {
    exts.push(ReviewCommentMark);
  }

  return exts;
}
