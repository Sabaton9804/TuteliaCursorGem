import Paragraph from '@tiptap/extension-paragraph';
import type { Editor } from '@tiptap/core';

/** Espacio extra tipo Word «después del párrafo» (~10 pt). */
export const MEMBRETE_PARAGRAPH_SPACE_PT = 10;

const spaceCss = () => `${MEMBRETE_PARAGRAPH_SPACE_PT}pt`;

type MembreteSpacingChain = {
  toggleMembreteSpaceBefore: () => { run: () => boolean };
  toggleMembreteSpaceAfter: () => { run: () => boolean };
};

function asMembreteSpacingChain(editor: Editor): MembreteSpacingChain {
  return editor.chain().focus() as unknown as MembreteSpacingChain;
}

export function runMembreteToggleSpaceBefore(editor: Editor): void {
  asMembreteSpacingChain(editor).toggleMembreteSpaceBefore().run();
}

export function runMembreteToggleSpaceAfter(editor: Editor): void {
  asMembreteSpacingChain(editor).toggleMembreteSpaceAfter().run();
}

/**
 * Párrafo con márgenes verticales editables (equivalente a «espacio antes/después» en Word).
 * Se integra con TextAlign (varios atributos aportan `style` y TipTap los fusiona).
 */
export const MembreteParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      paragraphMarginBefore: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).style.marginTop || null,
        renderHTML: (attrs) => {
          const v = attrs.paragraphMarginBefore as string | null | undefined;
          if (!v) return {};
          return { style: `margin-top: ${v}` };
        },
      },
      paragraphMarginAfter: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).style.marginBottom || null,
        renderHTML: (attrs) => {
          const v = attrs.paragraphMarginAfter as string | null | undefined;
          if (!v) return {};
          return { style: `margin-bottom: ${v}` };
        },
      },
    };
  },

  addCommands() {
    const s = spaceCss();
    return {
      ...this.parent?.(),
      toggleMembreteSpaceBefore:
        () =>
        ({ editor, chain }) =>
          chain()
            .focus()
            .updateAttributes('paragraph', {
              paragraphMarginBefore: editor.getAttributes('paragraph').paragraphMarginBefore ? null : s,
            })
            .run(),
      toggleMembreteSpaceAfter:
        () =>
        ({ editor, chain }) =>
          chain()
            .focus()
            .updateAttributes('paragraph', {
              paragraphMarginAfter: editor.getAttributes('paragraph').paragraphMarginAfter ? null : s,
            })
            .run(),
    };
  },
});
