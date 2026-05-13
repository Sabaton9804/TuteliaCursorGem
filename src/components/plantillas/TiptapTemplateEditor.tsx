import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { MessageSquarePlus } from 'lucide-react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { CommentThreadsMap } from '../../lib/review-markup-payload';
import { TiptapDespachoReviewChrome } from './TiptapDespachoReviewChrome';
import {
  docToStorage,
  parseStorageToDoc,
  type ParseStorageOptions,
} from '../../lib/tiptap-template-storage';
import {
  JudicialDocEditor,
  type JudicialDocEditorHandle,
} from '../shared/JudicialDocEditor';

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
  /** Comentarios internos (borrador despacho): panel derecho + marcas; hilos solo en memoria del padre. */
  reviewComments?: {
    displayName: string | null;
    threads: CommentThreadsMap;
    setThreads: React.Dispatch<React.SetStateAction<CommentThreadsMap>>;
  } | null;
};

function minHeightFromTailwindClass(c?: string): string {
  const m = (c ?? '').match(/min-h-\[([^\]]+)\]/);
  if (m?.[1]) return m[1].trim();
  const m2 = (c ?? '').match(/min-h-(\d+)/);
  if (m2?.[1]) return `${m2[1]}rem`;
  return '400px';
}

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
      reviewComments = null,
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

    const reviewCommentsEnabled = Boolean(reviewComments);
    const judicialRef = useRef<JudicialDocEditorHandle>(null);
    const [mountedEditor, setMountedEditor] = useState<Editor | null>(null);

    const docContent = useMemo(() => parseStorageToDoc(value, parseOpts), [value, parseOpts]);

    const handleDocChange = useCallback((json: JSONContent) => {
      const serialized = docToStorage(json);
      if (serialized === canonicalRef.current(valueRef.current)) return;
      onChangeRef.current(serialized);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        insertVariable: (key: string) => {
          judicialRef.current?.insertVariable(key);
        },
        focus: () => {
          judicialRef.current?.focus();
        },
      }),
      [],
    );

    const focusDespachoCommentBox = useCallback(() => {
      requestAnimationFrame(() => {
        document.getElementById('tutelia-despacho-new-comment')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        (document.getElementById('tutelia-despacho-new-comment') as HTMLTextAreaElement | null)?.focus();
      });
    }, []);

    const minHeight = minHeightFromTailwindClass(minHeightClass);

    return (
      <div
        className={`bg-transparent ${disabled ? 'opacity-60' : ''} ${
          reviewComments ? 'flex min-h-[min(52vh,22rem)] flex-col gap-0 md:min-h-[min(60vh,28rem)] md:flex-row md:items-stretch' : ''
        }`}
      >
        <div className={`min-w-0 flex-1 ${reviewComments ? 'md:min-h-0' : ''}`}>
          {mountedEditor && reviewComments && !disabled ? (
            <BubbleMenu
              editor={mountedEditor}
              shouldShow={({ editor: ed }) => !ed.state.selection.empty}
              options={{ placement: 'bottom-start' }}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={focusDespachoCommentBox}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-900 shadow-md hover:bg-violet-50"
              >
                <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Comentario en el margen
              </button>
            </BubbleMenu>
          ) : null}
          <JudicialDocEditor
            ref={judicialRef}
            content={docContent}
            onChange={handleDocChange}
            readOnly={Boolean(disabled)}
            showComments={reviewCommentsEnabled}
            hideInlineCommentBubble={reviewCommentsEnabled}
            placeholder={placeholder ?? 'Escriba el documento…'}
            minHeight={minHeight}
            plantillaResolveLabel={resolveLabel}
            onEditorReady={setMountedEditor}
            className="tiptap-template-focus text-sm leading-relaxed px-0 py-1"
          />
        </div>
        {reviewComments ? (
          <TiptapDespachoReviewChrome
            editor={mountedEditor}
            disabled={disabled}
            displayName={reviewComments.displayName}
            threads={reviewComments.threads}
            onThreadsChange={reviewComments.setThreads}
          />
        ) : null}
      </div>
    );
  },
);

TiptapTemplateEditor.displayName = 'TiptapTemplateEditor';
