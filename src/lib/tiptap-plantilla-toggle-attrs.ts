import { Extension } from '@tiptap/core';

/** Permite marcar párrafos / encabezados / celdas con `toggleKey` (id de `DocumentTemplateToggleDef`). */
export const PlantillaToggleAttrs = Extension.create({
  name: 'plantillaToggleAttrs',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'tableCell', 'tableHeader'],
        attributes: {
          toggleKey: {
            default: null as string | null,
            parseHTML: (element) => element.getAttribute('data-toggle-key'),
            renderHTML: (attributes) => {
              const key = attributes.toggleKey as string | null | undefined;
              if (!key || !String(key).trim()) return {};
              return { 'data-toggle-key': String(key).trim() };
            },
          },
        },
      },
    ];
  },
});
