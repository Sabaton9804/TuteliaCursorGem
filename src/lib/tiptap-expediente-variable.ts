import { Node, mergeAttributes } from '@tiptap/core';

export interface ExpedienteVariableOptions {
  resolveLabel: (key: string) => string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    expedienteVariable: {
      insertExpedienteVariable: (key: string) => ReturnType;
    };
  }
}

/** Nodo atómico que muestra etiqueta legible y serializa a {{CLAVE}}. */
export const ExpedienteVariable = Node.create<ExpedienteVariableOptions>({
  name: 'expedienteVariable',
  group: 'inline',
  atom: true,
  inline: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      resolveLabel: (key: string) => key,
    };
  },

  addAttributes() {
    return {
      key: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-key') ?? '',
        renderHTML: (attrs) => ({ 'data-key': attrs.key as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-expediente-variable]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const key = String(node.attrs.key ?? '');
    const label = this.options.resolveLabel(key);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-expediente-variable': '',
        class:
          'rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 font-sans text-[12px] font-semibold text-violet-900',
      }),
      label,
    ];
  },

  addCommands() {
    return {
      insertExpedienteVariable:
        (key: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { key } }),
    };
  },
});
