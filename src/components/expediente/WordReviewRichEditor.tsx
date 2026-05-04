import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  AlignJustify,
  AlignLeft,
  Highlighter,
  Loader2,
  MessageSquarePlus,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CASE_DOCUMENTS_BUCKET } from '../../lib/case-document-storage';
import { docxArrayBufferToTipTapSeedDoc } from '../../lib/docx-to-tiptap-review-seed';
import { WORD_REVIEW_RICH_EXTENSIONS } from '../../lib/word-review-rich-extensions';

export type ReviewMarkupPayloadV1 = { v: 1; doc: JSONContent };

export type WordReviewRichSaverApi = { flush: () => Promise<ReviewMarkupPayloadV1 | void> };

type Props = {
  storagePath: string;
  /** Si existe, se usa como contenido inicial (no se re-semilla desde el .docx). */
  savedMarkup: ReviewMarkupPayloadV1 | null;
  readOnly?: boolean;
  /** Solo lectura: puede omitirse. */
  onDebouncedSave?: (payload: ReviewMarkupPayloadV1) => void | Promise<unknown>;
  /** Para guardar justo antes de enviar observaciones (evita perder el último tecleo). */
  registerSaverApi?: (api: WordReviewRichSaverApi | null) => void;
};

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

function isPayloadV1(raw: unknown): raw is ReviewMarkupPayloadV1 {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o.v === 1 && o.doc != null && typeof o.doc === 'object';
}

export function WordReviewRichEditor({
  storagePath,
  savedMarkup,
  readOnly,
  onDebouncedSave,
  registerSaverApi,
}: Props) {
  const [seed, setSeed] = useState<JSONContent | null>(() => (savedMarkup ? savedMarkup.doc : null));
  const [seedErr, setSeedErr] = useState<string | null>(null);
  const [seedLoading, setSeedLoading] = useState(!savedMarkup);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const savedSer = savedMarkup ? JSON.stringify(savedMarkup.doc) : '';

  useEffect(() => {
    if (savedMarkup?.doc) {
      setSeed((prev) => {
        const next = savedMarkup.doc;
        if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return next;
      });
      setSeedLoading(false);
      setSeedErr(null);
      return;
    }
    let cancelled = false;
    const path = storagePath.trim();
    if (!path) {
      setSeedErr('Sin ruta de documento.');
      setSeedLoading(false);
      setSeed(EMPTY_DOC);
      return;
    }
    setSeedLoading(true);
    setSeedErr(null);
    void (async () => {
      try {
        const { data, error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
        if (cancelled) return;
        if (error || !data) throw new Error(error?.message || 'No se pudo descargar el Word.');
        const buf = await data.arrayBuffer();
        const doc = await docxArrayBufferToTipTapSeedDoc(buf);
        if (!cancelled) {
          setSeed(doc);
          setSeedLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setSeedErr(e instanceof Error ? e.message : 'No se pudo preparar el editor.');
          setSeed(EMPTY_DOC);
          setSeedLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath, savedSer]);

  const scheduleSave = useCallback(
    (doc: JSONContent) => {
      if (readOnly || !onDebouncedSave) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void Promise.resolve(onDebouncedSave({ v: 1, doc })).catch(() => {});
      }, 1800);
    },
    [onDebouncedSave, readOnly],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const editor = useEditor(
    {
      extensions: WORD_REVIEW_RICH_EXTENSIONS,
      content: seed ?? EMPTY_DOC,
      editable: !readOnly,
      editorProps: {
        attributes: {
          class:
            'word-review-rich-editor prose prose-sm max-w-none min-h-[220px] px-4 py-3 focus:outline-none text-slate-900',
        },
      },
      onUpdate: ({ editor }) => {
        scheduleSave(editor.getJSON());
      },
    },
    [seed, readOnly],
  );

  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!registerSaverApi) return;
    if (!editor || readOnly || !onDebouncedSave) {
      registerSaverApi(null);
      return;
    }
    const api: WordReviewRichSaverApi = {
      flush: async () => {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        const payload: ReviewMarkupPayloadV1 = { v: 1, doc: editor.getJSON() };
        await Promise.resolve(onDebouncedSave(payload));
        return payload;
      },
    };
    registerSaverApi(api);
    return () => registerSaverApi(null);
  }, [editor, readOnly, onDebouncedSave, registerSaverApi]);

  const [toolbarRev, bumpToolbar] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => bumpToolbar();
    editor.on('selectionUpdate', tick);
    editor.on('transaction', tick);
    return () => {
      editor.off('selectionUpdate', tick);
      editor.off('transaction', tick);
    };
  }, [editor]);

  const bubbleKey = useMemo(() => `${readOnly ? 1 : 0}-${toolbarRev}`, [readOnly, toolbarRev]);

  if (seedLoading || seed === null) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm font-medium">Preparando editor de revisión…</span>
      </div>
    );
  }

  if (seedErr && seed === EMPTY_DOC) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{seedErr}</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-indigo-200/80 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-indigo-50/50 px-2 py-2">
        {!readOnly && editor ? (
          <>
            {/* toolbarTick fuerza lectura de isActive tras cada transacción */}
            <span className="hidden" aria-hidden>
              {toolbarRev}
            </span>
            <ToolbarBtn
              pressed={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              label="Subrayado"
            >
              <UnderlineIcon className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn
              pressed={editor.isActive('highlight')}
              onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}
              label="Resaltar"
            >
              <Highlighter className="h-4 w-4" />
            </ToolbarBtn>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <ToolbarBtn
              pressed={editor.isActive({ textAlign: 'left' })}
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
              label="Alinear izquierda"
            >
              <AlignLeft className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn
              pressed={editor.isActive({ textAlign: 'justify' })}
              onClick={() => editor.chain().focus().setTextAlign('justify').run()}
              label="Justificar"
            >
              <AlignJustify className="h-4 w-4" />
            </ToolbarBtn>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <span className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Comentario: seleccione texto y use el globo
            </span>
          </>
        ) : (
          <span className="px-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Revisión guardada (solo lectura)
          </span>
        )}
      </div>

      {editor && !readOnly ? (
        <BubbleMenu key={bubbleKey} editor={editor} options={{ placement: 'top' }}>
          <div className="flex max-w-[min(100vw-2rem,22rem)] flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Comentario sobre la selección
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                rows={3}
                className="input-modern mt-1 w-full resize-y text-xs"
                placeholder="Ej.: Corregir cita; unificar numeral; verificar competencia…"
              />
            </label>
            <button
              type="button"
              disabled={!commentDraft.trim() || editor.state.selection.empty}
              onClick={() => {
                const body = commentDraft.trim();
                if (!body || editor.state.selection.empty) return;
                const id =
                  typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `c-${Date.now()}`;
                editor.chain().focus().setMark('reviewComment', { id, body }).run();
                setCommentDraft('');
              }}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Aplicar comentario
            </button>
          </div>
        </BubbleMenu>
      ) : null}

      {editor ? <EditorContent editor={editor} /> : null}

      {seedErr ? (
        <p className="border-t border-amber-100 bg-amber-50/90 px-3 py-2 text-[10px] text-amber-950">
          Aviso: {seedErr} — puede editar sobre el contenido recuperado.
        </p>
      ) : null}

      {!readOnly ? (
        <p className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-500">
          Los cambios se guardan solos en Tutelia (unos segundos después de escribir). El .docx del expediente no se
          modifica aquí: para enviar correcciones al archivo Word use descarga, edición en Word y nueva carga al
          expediente.
        </p>
      ) : null}
    </div>
  );
}

function ToolbarBtn({
  children,
  label,
  pressed,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded-lg p-2 text-slate-700 hover:bg-white/90 ${
        pressed ? 'bg-white shadow-sm ring-1 ring-indigo-200' : ''
      }`}
    >
      {children}
    </button>
  );
}

export function parseReviewMarkupPayload(raw: unknown): ReviewMarkupPayloadV1 | null {
  if (!isPayloadV1(raw)) return null;
  return raw;
}
