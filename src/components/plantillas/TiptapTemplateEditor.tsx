import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, List, ListOrdered, Heading3 } from 'lucide-react';
import { ExpedienteVariable } from '../../lib/tiptap-expediente-variable';
import { docToStorage, parseStorageToDoc } from '../../lib/tiptap-template-storage';

export type TiptapTemplateEditorHandle = {
  insertVariable: (key: string) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  resolveLabel: (key: string) => string;
  placeholder?: string;
  disabled?: boolean;
  minHeightClass?: string;
};

export const TiptapTemplateEditor = forwardRef<TiptapTemplateEditorHandle, Props>(
  function TiptapTemplateEditorInner(
    { value, onChange, resolveLabel, placeholder, disabled, minHeightClass = 'min-h-[14rem]' },
    ref,
  ) {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [3, 4] },
        }),
        ExpedienteVariable.configure({ resolveLabel }),
        Placeholder.configure({
          placeholder: placeholder ?? 'Escriba el documento…',
        }),
      ],
      content: parseStorageToDoc(value),
      editable: !disabled,
      editorProps: {
        attributes: {
          class: `tiptap-template-focus ${minHeightClass} px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none`,
        },
      },
      onUpdate: ({ editor: ed }) => {
        onChange(docToStorage(ed.getJSON()));
      },
    });

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      const next = parseStorageToDoc(value);
      const cur = editor.getJSON();
      if (JSON.stringify(cur) !== JSON.stringify(next)) {
        editor.commands.setContent(next, { emitUpdate: false });
      }
    }, [value, editor]);

    useImperativeHandle(
      ref,
      () => ({
        insertVariable: (key: string) => {
          editor?.chain().focus().insertExpedienteVariable(key).run();
        },
        focus: () => {
          editor?.chain().focus().run();
        },
      }),
      [editor],
    );

    return (
      <div
        className={`overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${disabled ? 'opacity-60' : ''}`}
      >
        <EditorToolbar editor={editor} disabled={disabled} />
        <EditorContent editor={editor} className={`tiptap-template-editor ${minHeightClass} max-w-none`} />
      </div>
    );
  },
);

TiptapTemplateEditor.displayName = 'TiptapTemplateEditor';

function EditorToolbar({ editor, disabled }: { editor: Editor | null; disabled?: boolean }) {
  const [, setToolbarTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const fn = () => setToolbarTick((t) => t + 1);
    editor.on('selectionUpdate', fn);
    editor.on('transaction', fn);
    return () => {
      editor.off('selectionUpdate', fn);
      editor.off('transaction', fn);
    };
  }, [editor]);

  if (!editor) {
    return <div className="h-10 border-b border-slate-100 bg-slate-50" aria-hidden />;
  }
  const btn = (active: boolean) =>
    `rounded-md px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
    } disabled:opacity-40`;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50/90 px-2 py-1.5">
      <span className="mr-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Formato</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive('bold'))}
        title="Negrita"
      >
        <Bold className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive('italic'))}
        title="Cursiva"
      >
        <Italic className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btn(editor.isActive('heading', { level: 3 }))}
        title="Subtítulo"
      >
        <Heading3 className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive('bulletList'))}
        title="Lista"
      >
        <List className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive('orderedList'))}
        title="Lista numerada"
      >
        <ListOrdered className="mx-0.5 h-3.5 w-3.5" />
      </button>
    </div>
  );
}
