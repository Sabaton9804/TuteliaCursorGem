import type { JSONContent } from '@tiptap/core';

function isBlockType(type: string | undefined): boolean {
  return (
    type === 'paragraph' ||
    type === 'heading' ||
    type === 'horizontalRule' ||
    type === 'blockquote' ||
    type === 'codeBlock' ||
    type === 'bulletList' ||
    type === 'orderedList' ||
    type === 'listItem' ||
    type === 'table'
  );
}

/** Texto plano para PDF u otros usos; conserva saltos aproximados entre bloques. */
export function tiptapJsonToPlainText(root: JSONContent | null | undefined): string {
  if (!root) return '';
  const parts: string[] = [];

  function dfs(n: JSONContent) {
    if (typeof n.text === 'string' && n.text.length > 0) parts.push(n.text);
    if (n.type === 'hardBreak') parts.push('\n');
    if (!n.content?.length) return;
    for (let i = 0; i < n.content.length; i++) {
      dfs(n.content[i]!);
      const c = n.content[i]!;
      if (isBlockType(c.type) && i < n.content.length - 1) parts.push('\n');
    }
  }

  dfs(root);
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
