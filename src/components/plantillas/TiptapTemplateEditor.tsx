import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Heading3,
  Italic,
  List,
  ListOrdered,
} from 'lucide-react';
import { buildPlantillaBodyExtensions } from '../../lib/tiptap-plantilla-editor-extensions';
import {
  docToStorage,
  parseStorageToDoc,
  type ParseStorageOptions,
} from '../../lib/tiptap-template-storage';

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
  /** Informe de ingreso: justificado por defecto en el párrafo «En la fecha…» si la plantilla no define alineación. */
  parseInformeBodyDefaults?: boolean;
};

export const TiptapTemplateEditor = forwardRef<TiptapTemplateEditorHandle, Props>(
  function TiptapTemplateEditorInner(
    {
      value,
      onChange,
      resolveLabel,
      placeholder,
      disabled,
      minHeightClass = 'min-h-[10rem]',
      parseInformeBodyDefaults = false,
    },
    ref,
  ) {
    const valueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    valueRef.current = value;
    onChangeRef.current = onChange;

    const parseOpts = useMemo((): ParseStorageOptions | undefined => {
      if (!parseInformeBodyDefaults) return undefined;
      return { informeCuerpoJustifyDefecto: true };
    }, [parseInformeBodyDefaults]);

    const canonicalDocStorage = useCallback((raw: string) => {
      try {
        return docToStorage(parseStorageToDoc(raw, parseOpts));
      } catch {
        return raw;
      }
    }, [parseOpts]);
    const canonicalRef = useRef(canonicalDocStorage);
    canonicalRef.current = canonicalDocStorage;

    const extensions = useMemo(
      () =>
        buildPlantillaBodyExtensions(resolveLabel, {
          placeholder: placeholder ?? 'Escriba el documento…',
        }),
      [resolveLabel, placeholder],
    );

    /**
     * No pasar `content` al crear el editor: el primer `onUpdate` puede dispararse antes de que el padre
     * haya inyectado el borrador y vaciaba `informeDraft` en expediente (y `informeDraftTouchedRef` quedaba en true).
     * Sincronizamos con `setContent(..., { emitUpdate: false })` en layout; `onUpdate` solo refleja edición real.
     * `useEditor` no recrea el callback en cada render: usamos refs para `value` / `onChange`.
     */
    const syncReadyRef = useRef(false);

    const editor = useEditor(
      {
        extensions,
        editable: !disabled,
        immediatelyRender: false,
        editorProps: {
          attributes: {
            class: `tiptap-template-focus ${minHeightClass} px-0 py-1 text-sm leading-relaxed text-slate-900 outline-none`,
          },
        },
        onUpdate: ({ editor: ed }) => {
          if (!syncReadyRef.current) return;
          const serialized = docToStorage(ed.getJSON());
          if (serialized === canonicalRef.current(valueRef.current)) return;
          onChangeRef.current(serialized);
        },
      },
      [extensions, disabled, minHeightClass],
    );

    useLayoutEffect(() => {
      syncReadyRef.current = false;
      if (!editor || editor.isDestroyed) return;
      const next = parseStorageToDoc(value, parseOpts);
      const target = canonicalDocStorage(value);
      const current = docToStorage(editor.getJSON());
      if (current !== target) {
        editor.commands.setContent(next, { emitUpdate: false });
      }
      syncReadyRef.current = true;
    }, [value, editor, parseOpts, canonicalDocStorage]);

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
      <div className={`bg-transparent ${disabled ? 'opacity-60' : ''}`}>
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
    return <div className="h-9 border-b border-slate-200/30 bg-transparent" aria-hidden />;
  }
  const btn = (active: boolean) =>
    `rounded-md px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
      active ? 'bg-slate-200/50 text-slate-900' : 'text-slate-600 hover:bg-slate-100/60'
    } disabled:opacity-40`;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200/40 bg-transparent px-0 py-1.5">
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
      <span className="mx-0.5 h-4 w-px shrink-0 self-center bg-slate-200" aria-hidden />
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        className={btn(editor.isActive({ textAlign: 'left' }))}
        title="Alinear a la izquierda"
      >
        <AlignLeft className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        className={btn(editor.isActive({ textAlign: 'center' }))}
        title="Centrar"
      >
        <AlignCenter className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        className={btn(editor.isActive({ textAlign: 'right' }))}
        title="Alinear a la derecha"
      >
        <AlignRight className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        className={btn(editor.isActive({ textAlign: 'justify' }))}
        title="Justificar"
      >
        <AlignJustify className="mx-0.5 h-3.5 w-3.5" />
      </button>
      <span className="mx-0.5 h-4 w-px shrink-0 self-center bg-slate-200" aria-hidden />
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
