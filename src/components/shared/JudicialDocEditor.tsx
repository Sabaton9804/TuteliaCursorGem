import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Editor, Extensions, JSONContent } from '@tiptap/core';
import type { EditorProps } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import { BubbleMenu } from '@tiptap/react/menus';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  MessageSquarePlus,
  Table2,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { ExpedienteVariable } from '../../lib/tiptap-expediente-variable';
import { PlantillaToggleAttrs } from '../../lib/tiptap-plantilla-toggle-attrs';
import { ReviewCommentMark } from '../../lib/review-comment-mark';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const FONT_FAMILIES = [
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Garamond', label: 'Garamond' },
  { value: 'Courier New', label: 'Courier New' },
] as const;

const FONT_SIZES_PT = ['10', '11', '12', '14', '16'] as const;

/** Props públicas del editor judicial unificado. */
export interface JudicialDocEditorProps {
  content: JSONContent | null;
  onChange?: (content: JSONContent) => void;
  readOnly?: boolean;
  showComments?: boolean;
  placeholder?: string;
  minHeight?: string;
  /** Corrector ortográfico del navegador en el área editable (recomendado en borradores del despacho). */
  browserSpellCheck?: boolean;
}

/** Compatibilidad con integraciones existentes hasta unificar llamadas (paso 2). */
type JudicialDocEditorLegacyProps = {
  plantillaResolveLabel?: (key: string) => string;
  hideInlineCommentBubble?: boolean;
  unframed?: boolean;
  /** Barra ancha con grupos y tipografía «hoja» (solo layout; no cambia persistencia). */
  despachoSheetChrome?: boolean;
  onEditorReady?: (editor: Editor | null) => void;
  className?: string;
  /** Se fusiona con las props por defecto del editor (p. ej. `handleDOMEvents` en plantillas). */
  extraEditorProps?: Partial<EditorProps>;
};

type JudicialDocEditorAllProps = JudicialDocEditorProps & JudicialDocEditorLegacyProps;

export type JudicialDocEditorHandle = {
  focus: () => void;
  insertVariable: (key: string) => void;
  getEditor: () => Editor | null;
};

function stableSerialize(doc: JSONContent | null): string {
  try {
    return JSON.stringify(doc ?? EMPTY_DOC);
  } catch {
    return '';
  }
}

function buildExtensions(opts: {
  placeholder?: string;
  plantillaResolveLabel?: (key: string) => string;
  showComments: boolean;
}) {
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
  ];

  if (opts.placeholder?.trim()) {
    exts.push(
      Placeholder.configure({
        placeholder: opts.placeholder.trim(),
      }),
    );
  }

  if (opts.plantillaResolveLabel) {
    exts.push(
      PlantillaToggleAttrs,
      ExpedienteVariable.configure({ resolveLabel: opts.plantillaResolveLabel }),
    );
  }

  if (opts.showComments) {
    exts.push(ReviewCommentMark);
  }

  return exts;
}

export const JudicialDocEditor = forwardRef<JudicialDocEditorHandle, JudicialDocEditorAllProps>(
  function JudicialDocEditorInner(
    {
      content,
      onChange,
      readOnly = false,
      showComments = false,
      placeholder = '',
      minHeight = '400px',
      browserSpellCheck = false,
      plantillaResolveLabel,
      hideInlineCommentBubble = false,
      unframed = false,
      despachoSheetChrome = false,
      onEditorReady,
      className = '',
      extraEditorProps,
    },
    ref,
  ) {
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const contentRef = useRef(content);
    contentRef.current = content;
    /** Evita eco controlado: padre → parse → setContent que mueve el cursor al pie. */
    const lastAppliedRef = useRef<string>(stableSerialize(content));
    const pendingExternalContentRef = useRef(false);

    const editorProps = useMemo((): EditorProps => {
      const baseClass = despachoSheetChrome
        ? `judicial-doc-editor judicial-despacho-sheet-editor prose max-w-none w-full text-slate-900 focus:outline-none px-0 py-2 [&_.ProseMirror]:min-h-[inherit] [&_.ProseMirror]:font-['Times_New_Roman',Times,serif] [&_.ProseMirror]:text-[12pt] [&_.ProseMirror]:leading-[1.5] [&_.ProseMirror]:outline-none ${className}`.trim()
        : `judicial-doc-editor prose prose-sm max-w-none text-slate-900 focus:outline-none px-4 py-3 ${className}`.trim();
      const extra = extraEditorProps;
      const rawExtraAttr = extra?.attributes;
      const extraAttr: Record<string, string> =
        rawExtraAttr && typeof rawExtraAttr === 'object' && !Array.isArray(rawExtraAttr)
          ? { ...(rawExtraAttr as Record<string, string>) }
          : {};
      const mergedClass = [extraAttr.class, baseClass].filter(Boolean).join(' ').trim();
      return {
        ...extra,
        attributes: {
          ...extraAttr,
          class: mergedClass,
          style: `min-height: ${minHeight}`,
          spellcheck: browserSpellCheck ? 'true' : 'false',
        },
        handleDOMEvents: {
          ...(extra?.handleDOMEvents ?? {}),
        },
      };
    }, [extraEditorProps, minHeight, className, despachoSheetChrome, browserSpellCheck]);

    const extensions = useMemo(
      () =>
        buildExtensions({
          placeholder: placeholder?.trim() || undefined,
          plantillaResolveLabel,
          showComments: Boolean(showComments),
        }),
      [placeholder, plantillaResolveLabel, showComments],
    );

    const [bubbleTick, bumpBubble] = useReducer((n: number) => n + 1, 0);
    const [commentDraft, setCommentDraft] = useState('');

    const editor = useEditor(
      {
        extensions,
        editable: !readOnly,
        immediatelyRender: false,
        content: content ?? EMPTY_DOC,
        editorProps,
        onUpdate: ({ editor: ed }) => {
          const json = ed.getJSON();
          lastAppliedRef.current = stableSerialize(json);
          pendingExternalContentRef.current = false;
          onChangeRef.current?.(json);
        },
      },
      [extensions, readOnly, editorProps],
    );

    useEffect(() => {
      onEditorReady?.(editor ?? null);
      return () => {
        onEditorReady?.(null);
      };
    }, [editor, onEditorReady]);

    useEffect(() => {
      if (editor) editor.setEditable(!readOnly);
    }, [editor, readOnly]);

    const contentSer = stableSerialize(content);

    const applyExternalContent = useCallback(() => {
      if (!editor || editor.isDestroyed) return;
      const next = contentRef.current ?? EMPTY_DOC;
      const ser = stableSerialize(next);
      if (ser === lastAppliedRef.current) {
        pendingExternalContentRef.current = false;
        return;
      }
      try {
        const { from, to } = editor.state.selection;
        editor.commands.setContent(next, { emitUpdate: false });
        const maxPos = editor.state.doc.content.size;
        const safeFrom = Math.min(from, maxPos);
        const safeTo = Math.min(to, maxPos);
        if (safeFrom <= safeTo) {
          editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
        }
        lastAppliedRef.current = ser;
        pendingExternalContentRef.current = false;
      } catch {
        /* ignore */
      }
    }, [editor]);

    useLayoutEffect(() => {
      if (!editor || editor.isDestroyed) return;
      if (contentSer === lastAppliedRef.current) {
        pendingExternalContentRef.current = false;
        return;
      }
      // Mientras se escribe, no reemplazar el doc (el padre re-parsea y eso tiraba el cursor al final).
      if (editor.isFocused) {
        pendingExternalContentRef.current = true;
        return;
      }
      applyExternalContent();
    }, [contentSer, editor, applyExternalContent]);

    useEffect(() => {
      if (!editor) return;
      const onBlur = () => {
        if (!pendingExternalContentRef.current) return;
        queueMicrotask(() => {
          if (editor.isDestroyed || editor.isFocused) return;
          applyExternalContent();
        });
      };
      editor.on('blur', onBlur);
      return () => {
        editor.off('blur', onBlur);
      };
    }, [editor, applyExternalContent]);

    useEffect(() => {
      if (!editor || !showComments) return;
      const fn = () => bumpBubble();
      editor.on('selectionUpdate', fn);
      editor.on('transaction', fn);
      return () => {
        editor.off('selectionUpdate', fn);
        editor.off('transaction', fn);
      };
    }, [editor, showComments]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editor?.chain().focus().run();
        },
        insertVariable: (key: string) => {
          if (!plantillaResolveLabel || !editor) return;
          editor.chain().focus().insertExpedienteVariable(key).run();
        },
        getEditor: () => editor ?? null,
      }),
      [editor, plantillaResolveLabel],
    );

    const bubbleKey = `${readOnly ? 1 : 0}-${bubbleTick}`;

    const applyComment = useCallback(() => {
      if (!editor || readOnly) return;
      const body = commentDraft.trim();
      if (!body || editor.state.selection.empty) return;
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `c-${Date.now()}`;
      editor.chain().focus().setMark('reviewComment', { id, body }).run();
      setCommentDraft('');
    }, [commentDraft, editor, readOnly]);

    return (
      <div
        className={
          unframed
            ? despachoSheetChrome
              ? 'judicial-despacho-editor-root w-full min-w-0 overflow-hidden rounded-none border-0 bg-white shadow-none'
              : 'overflow-visible rounded-none border-0 bg-transparent shadow-none'
            : 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm'
        }
      >
        <JudicialDocToolbar editor={editor} readOnly={readOnly} sheetChrome={despachoSheetChrome} />
        {editor && showComments && !readOnly && !hideInlineCommentBubble ? (
          <BubbleMenu key={bubbleKey} editor={editor} options={{ placement: 'top' }}>
            <div className="flex max-w-[min(100vw-2rem,22rem)] flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Comentario sobre la selección
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  rows={3}
                  className="input-modern mt-1 w-full resize-y text-xs"
                  placeholder="Ej.: Corregir cita; unificar numeral…"
                />
              </label>
              <button
                type="button"
                disabled={!commentDraft.trim() || editor.state.selection.empty}
                onMouseDown={(e) => e.preventDefault()}
                onClick={applyComment}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                Aplicar comentario
              </button>
            </div>
          </BubbleMenu>
        ) : null}
        {editor ? <EditorContent editor={editor} /> : null}
      </div>
    );
  },
);

JudicialDocEditor.displayName = 'JudicialDocEditor';

function JudicialDocToolbar({
  editor,
  readOnly,
  sheetChrome = false,
}: {
  editor: Editor | null;
  readOnly: boolean;
  sheetChrome?: boolean;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const fn = () => tick((t) => t + 1);
    editor.on('selectionUpdate', fn);
    editor.on('transaction', fn);
    return () => {
      editor.off('selectionUpdate', fn);
      editor.off('transaction', fn);
    };
  }, [editor]);

  if (!editor) {
    return (
      <div
        className={`border-b border-slate-200 bg-slate-100 ${sheetChrome ? 'h-11 w-full' : 'h-10 border-slate-100 bg-slate-50/80'}`}
        aria-hidden
      />
    );
  }

  if (readOnly) {
    return (
      <div
        className={`flex flex-wrap items-center border-b border-slate-200 bg-slate-100 px-3 py-2 ${sheetChrome ? 'w-full' : 'gap-2 border-slate-100 bg-slate-50/80 px-2 py-2'}`}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Solo lectura</span>
      </div>
    );
  }

  const btn = (active: boolean) =>
    `rounded-md p-2 text-slate-800 transition hover:bg-white disabled:opacity-40 ${
      active ? 'bg-white shadow-sm ring-1 ring-slate-300/90' : 'hover:ring-1 hover:ring-slate-200/80'
    }`;

  const selectClass = sheetChrome
    ? 'h-9 rounded-md border border-slate-300/90 bg-white px-2.5 text-xs font-medium text-slate-900 shadow-sm'
    : 'h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800';

  const currentFont =
    FONT_FAMILIES.find((f) => {
      const ff = editor.getAttributes('textStyle')?.fontFamily as string | undefined;
      return typeof ff === 'string' && ff.replace(/^['"]|['"]$/g, '').trim() === f.value;
    })?.value ?? '';

  const rawSize = editor.getAttributes('textStyle')?.fontSize as string | undefined;
  const currentSizePt =
    typeof rawSize === 'string' && /^\d+(\.\d+)?pt$/i.test(rawSize.trim())
      ? rawSize.replace(/pt$/i, '')
      : typeof rawSize === 'string' && /^\d+(\.\d+)?px$/i.test(rawSize.trim())
        ? String(Math.round((Number(rawSize.replace(/px$/i, '')) * 72) / 96))
        : '';

  const currentColor = (editor.getAttributes('textStyle')?.color as string | undefined) || '#000000';

  const groupWrap = (children: ReactNode) => (
    <div
      className={
        sheetChrome
          ? 'flex flex-wrap items-center gap-1 border-r border-slate-300/80 pr-4 last:border-r-0 last:pr-0'
          : 'contents'
      }
    >
      {children}
    </div>
  );

  const toolbarInner = (
    <>
      {groupWrap(
        <>
          <select
            aria-label="Familia de fuente"
            className={`${selectClass} ${sheetChrome ? 'min-w-[11rem] max-w-[14rem]' : 'max-w-[10.5rem]'}`}
            value={currentFont}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) editor.chain().focus().unsetFontFamily().run();
              else editor.chain().focus().setFontFamily(v).run();
            }}
          >
            <option value="">Predeterminada</option>
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Tamaño de fuente"
            className={`${selectClass} w-[4.75rem]`}
            value={FONT_SIZES_PT.includes(currentSizePt as (typeof FONT_SIZES_PT)[number]) ? currentSizePt : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) editor.chain().focus().unsetFontSize().run();
              else editor.chain().focus().setFontSize(`${v}pt`).run();
            }}
          >
            <option value="">—</option>
            {FONT_SIZES_PT.map((s) => (
              <option key={s} value={s}>
                {s} pt
              </option>
            ))}
          </select>
        </>,
      )}

      {groupWrap(
        <>
          {!sheetChrome ? <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden /> : null}
          <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-300/90 bg-white px-1.5 shadow-sm">
            <span className="sr-only">Color de texto</span>
            <input
              type="color"
              aria-label="Color de texto"
              className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
              value={/^#[0-9a-fA-F]{6}$/.test(currentColor) ? currentColor : '#000000'}
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            />
          </label>
        </>,
      )}

      {groupWrap(
        <>
          {!sheetChrome ? <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden /> : null}
          <button
            type="button"
            title="Negrita"
            aria-label="Negrita"
            aria-pressed={editor.isActive('bold')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={btn(editor.isActive('bold'))}
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Cursiva"
            aria-label="Cursiva"
            aria-pressed={editor.isActive('italic')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={btn(editor.isActive('italic'))}
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Subrayado"
            aria-label="Subrayado"
            aria-pressed={editor.isActive('underline')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={btn(editor.isActive('underline'))}
          >
            <UnderlineIcon className="h-4 w-4" />
          </button>
        </>,
      )}

      {groupWrap(
        <>
          {!sheetChrome ? <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden /> : null}
          <button
            type="button"
            title="Alinear a la izquierda"
            aria-label="Alinear a la izquierda"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={btn(editor.isActive({ textAlign: 'left' }))}
          >
            <AlignLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Centrar"
            aria-label="Centrar"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={btn(editor.isActive({ textAlign: 'center' }))}
          >
            <AlignCenter className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Alinear a la derecha"
            aria-label="Alinear a la derecha"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            className={btn(editor.isActive({ textAlign: 'right' }))}
          >
            <AlignRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Justificar"
            aria-label="Justificar"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            className={btn(editor.isActive({ textAlign: 'justify' }))}
          >
            <AlignJustify className="h-4 w-4" />
          </button>
        </>,
      )}

      {groupWrap(
        <>
          {!sheetChrome ? <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden /> : null}
          <button
            type="button"
            title="Lista con viñetas"
            aria-label="Lista con viñetas"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={btn(editor.isActive('bulletList'))}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Lista numerada"
            aria-label="Lista numerada"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={btn(editor.isActive('orderedList'))}
          >
            <ListOrdered className="h-4 w-4" />
          </button>
        </>,
      )}

      {groupWrap(
        <>
          {!sheetChrome ? <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden /> : null}
          <button
            type="button"
            title="Insertar tabla"
            aria-label="Insertar tabla"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            className={btn(false)}
          >
            <Table2 className="h-4 w-4" />
          </button>
        </>,
      )}
    </>
  );

  if (sheetChrome) {
    return (
      <div
        role="toolbar"
        aria-label="Formato del documento"
        className="w-full min-w-0 border-b border-slate-300 bg-gradient-to-b from-[#f0f0f2] to-[#e6e7eb] px-3 py-2.5 shadow-[inset_0_-1px_0_rgba(255,255,255,0.65)]"
      >
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-2">{toolbarInner}</div>
      </div>
    );
  }

  return <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/90 px-2 py-2">{toolbarInner}</div>;
}
