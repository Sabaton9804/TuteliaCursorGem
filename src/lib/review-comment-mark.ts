import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Marca de comentario de revisión (subrayado + tooltip con texto). Todo queda en el JSON TipTap.
 */
export const ReviewCommentMark = Mark.create({
  name: 'reviewComment',
  inclusive: false,
  addAttributes() {
    return {
      id: { default: null },
      body: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-review-comment]',
        getAttrs: (el) => {
          const node = el as HTMLElement;
          return {
            id: node.getAttribute('data-id') || null,
            body: node.getAttribute('data-body') || '',
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const id = HTMLAttributes.id as string | null;
    const body = (HTMLAttributes.body as string) || '';
    return [
      'span',
      mergeAttributes(
        {
          'data-review-comment': '1',
          'data-id': id ?? '',
          'data-body': body,
          class: 'review-comment-mark',
          title: body.slice(0, 500),
        },
        HTMLAttributes,
      ),
      0,
    ];
  },
});
