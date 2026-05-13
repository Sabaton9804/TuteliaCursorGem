import type { Extensions } from '@tiptap/core';
import { buildJudicialDocEditorExtensions } from './judicial-doc-editor-extensions';

/**
 * Alias histórico: mismo esquema que `JudicialDocEditor` (plantilla + expediente + revisión).
 */
export function buildPlantillaBodyExtensions(
  resolveLabel: (key: string) => string,
  options?: { placeholder?: string; reviewComments?: boolean },
): Extensions {
  return buildJudicialDocEditorExtensions({
    placeholder: options?.placeholder,
    plantillaNodes: { resolveLabel },
    showComments: Boolean(options?.reviewComments),
  });
}
