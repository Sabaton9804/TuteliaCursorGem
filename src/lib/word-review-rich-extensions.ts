import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { ReviewCommentMark } from './review-comment-mark';

/** Extensiones compartidas: semilla desde mammoth/HTML y editor de revisión en Tutelia. */
export const WORD_REVIEW_RICH_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
  Underline,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight.configure({ multicolor: true }),
  Image.configure({ allowBase64: true }),
  Link.configure({ openOnClick: false, autolink: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  ReviewCommentMark,
];
