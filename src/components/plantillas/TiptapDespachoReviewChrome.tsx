import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { MessageCircle, Send, X } from 'lucide-react';
import type { CommentThreadsMap } from '../../lib/review-markup-payload';
import {
  collectReviewCommentsFromEditor,
  scrollReviewCommentIntoView,
} from '../../lib/review-editor-comments';

function cloneThreads(t: CommentThreadsMap | undefined): CommentThreadsMap {
  if (!t || typeof t !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(t)) as CommentThreadsMap;
  } catch {
    return {};
  }
}

function initials(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  if (!s) return '?';
  const p = s.split(/\s+/).filter(Boolean);
  if (p.length === 1) return p[0]!.slice(0, 2).toUpperCase();
  return `${p[0]![0] ?? ''}${p[p.length - 1]![0] ?? ''}`.toUpperCase() || '?';
}

type Props = {
  editor: Editor | null;
  disabled?: boolean;
  displayName: string | null;
  threads: CommentThreadsMap;
  onThreadsChange: (next: CommentThreadsMap) => void;
  /** Varias instancias en la misma página (p. ej. varias revisiones Word): ids DOM únicos. */
  editorDomIdSuffix?: string;
};

/**
 * Panel de comentarios + burbuja para el borrador del despacho (misma marca que revisión Word en Tutelia).
 * Los hilos viven en estado React del padre; no se serializan en `tiptap:` del cuerpo.
 */
export function TiptapDespachoReviewChrome({
  editor,
  disabled,
  displayName,
  threads,
  onThreadsChange,
  editorDomIdSuffix,
}: Props) {
  const newInputRef = useRef<HTMLTextAreaElement>(null);
  const [newDraft, setNewDraft] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [toolbarRev, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!editor) return;
    const fn = () => bump();
    editor.on('selectionUpdate', fn);
    editor.on('transaction', fn);
    return () => {
      editor.off('selectionUpdate', fn);
      editor.off('transaction', fn);
    };
  }, [editor]);

  const comments = useMemo(() => {
    if (!editor) return [];
    return collectReviewCommentsFromEditor(editor);
  }, [editor, toolbarRev]);

  const selectionSnippet = useMemo(() => {
    if (!editor || editor.state.selection.empty) return '';
    const { from, to } = editor.state.selection;
    return editor.state.doc
      .textBetween(from, to, '\n')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  }, [editor, toolbarRev]);

  const selectionEmpty = !editor || editor.state.selection.empty;
  const label = displayName?.trim() || 'Usuario';

  const submitNew = useCallback(() => {
    if (!editor || disabled) return;
    const body = newDraft.trim();
    const { from, to } = editor.state.selection;
    if (!body || from === to) return;
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}`;
    editor.chain().focus().setTextSelection({ from, to }).setMark('reviewComment', { id, body }).run();
    setNewDraft('');
    onThreadsChange({ ...cloneThreads(threads), [id]: threads[id] ?? { replies: [] } });
  }, [editor, disabled, newDraft, threads, onThreadsChange]);

  const submitReply = useCallback(
    (commentId: string) => {
      if (!editor || disabled) return;
      const body = (replyDraft[commentId] ?? '').trim();
      if (!body) return;
      const rid =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}`;
      const at = new Date().toISOString();
      const prev = cloneThreads(threads);
      onThreadsChange({
        ...prev,
        [commentId]: {
          replies: [...(prev[commentId]?.replies ?? []), { id: rid, body, at }],
        },
      });
      setReplyDraft((s) => ({ ...s, [commentId]: '' }));
    },
    [editor, disabled, replyDraft, threads, onThreadsChange],
  );

  useEffect(() => {
    if (!editor || comments.length === 0) return;
    const { from } = editor.state.selection;
    const hit = comments.find((c) => from >= c.from && from <= c.to);
    setActiveId(hit?.id ?? null);
  }, [editor, comments, toolbarRev]);

  if (!editor) return null;

  const suf = editorDomIdSuffix?.trim();
  const railDomId = suf ? `tutelia-despacho-review-rail-${suf}` : 'tutelia-despacho-review-rail';
  const newCommentDomId = suf ? `tutelia-despacho-new-comment-${suf}` : 'tutelia-despacho-new-comment';

  return (
    <aside
      id={railDomId}
      className="flex max-h-[min(52vh,24rem)] h-full min-h-0 w-full min-w-0 shrink-0 flex-col border-t border-slate-300/80 bg-slate-50 lg:max-h-none lg:border-l lg:border-t-0"
    >
      <div className="border-b border-slate-200/90 bg-white px-3 py-2">
        <p className="text-[11px] font-semibold text-slate-800">Comentarios sobre el borrador</p>
        <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
          No se incluyen en el .docx descargado; sirven para coordinación interna antes de enviar a revisión.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!disabled ? (
          <div
            className={`rounded-xl border-2 bg-white p-3 shadow-sm ${
              selectionEmpty ? 'border-slate-200' : 'border-violet-400 ring-1 ring-violet-100'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-[10px] font-bold text-white shadow-sm"
                aria-hidden
              >
                {initials(displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-900">{label}</p>
                {selectionSnippet ? (
                  <blockquote className="mt-2 border-l-4 border-violet-300 bg-violet-50/40 py-1 pl-2 text-[11px] leading-snug text-slate-700">
                    {selectionSnippet}
                    {selectionSnippet.length >= 220 ? '…' : ''}
                  </blockquote>
                ) : (
                  <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                    Seleccione texto en el documento para anclar el comentario.
                  </p>
                )}
                <textarea
                  id={newCommentDomId}
                  ref={newInputRef}
                  value={newDraft}
                  onChange={(e) => setNewDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      submitNew();
                    }
                  }}
                  rows={3}
                  disabled={selectionEmpty}
                  placeholder="Iniciar una conversación"
                  className="input-modern mt-2 w-full resize-y text-sm disabled:cursor-not-allowed disabled:bg-slate-50"
                />
                <p className="mt-1 text-[10px] text-slate-400">Ctrl+Entrar o ⌘+Entrar para publicar</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewDraft('')}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                    title="Borrar borrador"
                    aria-label="Borrar borrador"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={!newDraft.trim() || selectionEmpty}
                    onClick={submitNew}
                    className="inline-flex items-center gap-1.5 rounded-full bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Publicar
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {comments.map((c) => {
          const replies = threads[c.id]?.replies ?? [];
          const snippet = editor.state.doc
            .textBetween(c.from, c.to, '\n')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 200);
          const active = activeId === c.id;
          return (
            <div
              key={c.id}
              className={`rounded-xl border-2 bg-white p-3 shadow-sm ${
                active ? 'border-violet-500 ring-1 ring-violet-200' : 'border-violet-200'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveId(c.id);
                  scrollReviewCommentIntoView(editor, c.from, c.to);
                }}
                className="w-full text-left"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <MessageCircle className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800">Comentario</p>
                    {snippet ? (
                      <blockquote className="mt-2 border-l-4 border-violet-300 bg-violet-50/40 py-1 pl-2 text-[11px] text-slate-700">
                        {snippet}
                        {snippet.length >= 200 ? '…' : ''}
                      </blockquote>
                    ) : null}
                    <p className="mt-2 text-[13px] leading-snug text-slate-900">{c.body || '(sin texto)'}</p>
                  </div>
                </div>
              </button>
              {replies.length > 0 ? (
                <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 pl-11 text-[11px] text-slate-600">
                  {replies.map((r) => (
                    <li key={r.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <span className="text-slate-400">
                        {new Date(r.at).toLocaleString('es-CO', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        :{' '}
                      </span>
                      {r.body}
                    </li>
                  ))}
                </ul>
              ) : null}
              {!disabled ? (
                <div className="mt-3 border-t border-slate-100 pt-3 pl-11">
                  <textarea
                    value={replyDraft[c.id] ?? ''}
                    onChange={(e) => setReplyDraft((s) => ({ ...s, [c.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        submitReply(c.id);
                      }
                    }}
                    rows={2}
                    placeholder="Responder…"
                    className="input-modern w-full resize-y text-xs"
                  />
                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => submitReply(c.id)}
                      disabled={!(replyDraft[c.id] ?? '').trim()}
                      className="inline-flex items-center gap-1 rounded-full bg-violet-700 px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
                    >
                      <Send className="h-3 w-3" />
                      Publicar respuesta
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
