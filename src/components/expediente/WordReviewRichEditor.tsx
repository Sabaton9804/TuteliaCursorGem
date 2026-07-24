import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CASE_DOCUMENTS_BUCKET } from '../../lib/case-document-storage';
import {
  docxArrayBufferToTipTapSeedDoc,
  ensureTipTapDocJSON,
  isTipTapDocSubstantivelyEmpty,
} from '../../lib/docx-to-tiptap-review-seed';
import { docToStorage, parseStorageToDoc } from '../../lib/tiptap-template-storage';
import type { CaseWordReviewMarkupV1, UserRole, WordReviewStatus } from '../../types';
import type { PlantillasMembrete } from '../../lib/plantillas-store';
import type { CommentThreadsMap } from '../../lib/review-markup-payload';
import { JudicialDocEditor, type JudicialDocEditorHandle } from '../shared/JudicialDocEditor';
import { MembreteRichPreview } from '../plantillas/MembreteRichSurface';
import { TiptapDespachoReviewChrome } from '../plantillas/TiptapDespachoReviewChrome';

export type ReviewMarkupPayloadV1 = { v: 1; doc: JSONContent };

export type WordReviewRichSaverApi = { flush: () => Promise<CaseWordReviewMarkupV1 | void> };

export type WordReviewMarkupSavePayload = {
  storage: string;
  commentThreads?: CommentThreadsMap;
};

type Props = {
  storagePath: string;
  /** Cadena `tiptap:` persistida; vacía si sólo hay semilla desde el .docx. */
  reviewMarkup: string;
  /** `true` cuando en BD `review_markup_json` es null: no usar Mammoth; mostrar aviso de reenvío. */
  reviewMarkupJsonAbsent?: boolean;
  /** Membrete del despacho (misma fuente que el borrador en expediente). */
  membrete: PlantillasMembrete;
  /** Nombre visible en el carril de comentarios (p. ej. perfil en sesión). */
  reviewActorDisplayName?: string | null;
  /** Sufijo estable por revisión para ids DOM del carril (varias tarjetas abiertas). */
  commentRailDomIdSuffix?: string;
  /** Hilos de comentarios persistidos en BD (review_markup_json.commentThreads). */
  initialCommentThreads?: CommentThreadsMap;
  puedeEditar: boolean;
  /** Solo `import.meta.env.DEV`: depuración de permisos (role / status). */
  devAuth?: { role: UserRole | undefined; status: WordReviewStatus };
  onDebouncedSave?: (payload: WordReviewMarkupSavePayload) => void | Promise<unknown>;
  registerSaverApi?: (api: WordReviewRichSaverApi | null) => void;
};

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

function mmToCssPx(mm: number): string {
  return `${(mm * 96) / 25.4}px`;
}

function isPayloadV1(raw: unknown): raw is ReviewMarkupPayloadV1 {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o.v === 1 && o.doc != null && typeof o.doc === 'object';
}

/** Acepta `tiptap:…`, JSON TipTap `{ type:'doc'… }` serializado, o texto plano (legacy). */
function parseReviewStorageToDoc(raw: string): JSONContent {
  const t = raw.trim();
  if (!t) return EMPTY_DOC;
  if (t.startsWith('tiptap:')) return parseStorageToDoc(t);
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as JSONContent;
      if (j?.type === 'doc') return ensureTipTapDocJSON(j);
    } catch {
      /* seguir como texto */
    }
  }
  return parseStorageToDoc(t);
}

export function WordReviewRichEditor({
  storagePath,
  reviewMarkup,
  reviewMarkupJsonAbsent = false,
  membrete,
  reviewActorDisplayName = null,
  commentRailDomIdSuffix,
  initialCommentThreads,
  puedeEditar,
  devAuth,
  onDebouncedSave,
  registerSaverApi,
}: Props) {
  const [docxSeed, setDocxSeed] = useState<JSONContent | null>(null);
  const [seedErr, setSeedErr] = useState<string | null>(null);
  const [seedLoading, setSeedLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const judicialRef = useRef<JudicialDocEditorHandle>(null);
  const [bodyEditor, setBodyEditor] = useState<Editor | null>(null);
  const [commentThreads, setCommentThreads] = useState<CommentThreadsMap>(
    () => initialCommentThreads ?? {},
  );
  const commentThreadsRef = useRef(commentThreads);
  commentThreadsRef.current = commentThreads;

  useEffect(() => {
    setCommentThreads(initialCommentThreads ?? {});
  }, [initialCommentThreads]);

  const padRichCuerpo = useMemo(
    () => ({
      paddingTop: mmToCssPx(25),
      paddingRight: mmToCssPx(25),
      paddingBottom: mmToCssPx(25),
      paddingLeft: mmToCssPx(25),
    }),
    [],
  );

  const focusWordReviewCommentBox = useCallback(() => {
    const suf = commentRailDomIdSuffix?.trim();
    const id = suf ? `tutelia-despacho-new-comment-${suf}` : 'tutelia-despacho-new-comment';
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      (document.getElementById(id) as HTMLTextAreaElement | null)?.focus();
    });
  }, [commentRailDomIdSuffix]);

  const substantiveMarkupDoc = useMemo(() => {
    const t = reviewMarkup.trim();
    if (!t) return null;
    const parsed = parseReviewStorageToDoc(t);
    return isTipTapDocSubstantivelyEmpty(parsed) ? null : parsed;
  }, [reviewMarkup]);

  const legacyNoStoredMarkup = Boolean(reviewMarkupJsonAbsent) && !substantiveMarkupDoc;

  useEffect(() => {
    if (import.meta.env.DEV && devAuth) {
      console.log('role:', devAuth.role, 'status:', devAuth.status, 'puedeEditar:', puedeEditar);
    }
  }, [devAuth, puedeEditar]);

  useEffect(() => {
    const path = storagePath.trim();
    if (!path) {
      setSeedErr('Sin ruta de documento.');
      setSeedLoading(false);
      setDocxSeed(EMPTY_DOC);
      return;
    }

    if (legacyNoStoredMarkup) {
      setDocxSeed(null);
      setSeedErr(null);
      setSeedLoading(false);
      return;
    }

    if (substantiveMarkupDoc) {
      setDocxSeed(null);
      setSeedErr(null);
      setSeedLoading(false);
      return;
    }

    let cancelled = false;
    setSeedLoading(true);
    setSeedErr(null);
    setDocxSeed(null);

    void (async () => {
      try {
        const { data, error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
        if (cancelled) return;
        if (error || !data) throw new Error(error?.message || 'No se pudo descargar el Word.');
        const buf = await data.arrayBuffer();
        const doc = await docxArrayBufferToTipTapSeedDoc(buf);
        if (!cancelled) {
          setDocxSeed(doc);
          setSeedLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setSeedErr(e instanceof Error ? e.message : 'No se pudo preparar el editor.');
          setDocxSeed(EMPTY_DOC);
          setSeedLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storagePath, substantiveMarkupDoc, legacyNoStoredMarkup]);

  const editorContent = useMemo(() => {
    if (substantiveMarkupDoc) return substantiveMarkupDoc;
    if (docxSeed) return docxSeed;
    const t = reviewMarkup.trim();
    if (t) return parseReviewStorageToDoc(t);
    return EMPTY_DOC;
  }, [substantiveMarkupDoc, docxSeed, reviewMarkup]);

  const scheduleSave = useCallback(
    (doc: JSONContent) => {
      if (!puedeEditar || !onDebouncedSave) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        const storage = docToStorage(doc);
        void Promise.resolve(
          onDebouncedSave({ storage, commentThreads: commentThreadsRef.current }),
        ).catch(() => {});
      }, 1800);
    },
    [onDebouncedSave, puedeEditar],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!registerSaverApi) return;
    if (legacyNoStoredMarkup || !puedeEditar || !onDebouncedSave) {
      registerSaverApi(null);
      return;
    }
    const api: WordReviewRichSaverApi = {
      flush: async () => {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        const ed = judicialRef.current?.getEditor();
        if (!ed) return;
        const storage = docToStorage(ed.getJSON());
        const threads = commentThreadsRef.current;
        const payload: CaseWordReviewMarkupV1 = {
          v: 1,
          storage,
          ...(Object.keys(threads).length > 0 ? { commentThreads: threads } : {}),
        };
        await Promise.resolve(onDebouncedSave({ storage, commentThreads: threads }));
        return payload;
      },
    };
    registerSaverApi(api);
    return () => registerSaverApi(null);
  }, [legacyNoStoredMarkup, puedeEditar, onDebouncedSave, registerSaverApi]);

  const showSpinner = seedLoading && !substantiveMarkupDoc && docxSeed === null;

  if (legacyNoStoredMarkup) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-6 text-sm text-amber-950 shadow-sm">
        <p className="font-semibold text-amber-950">
          Este documento fue creado antes de la actualización.
        </p>
        <p className="mt-2 leading-relaxed text-amber-900/95">
          Descargue el .docx y vuelva a enviarlo a revisión para ver la vista en Jurion.
        </p>
      </div>
    );
  }

  if (showSpinner) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm font-medium">Preparando editor de revisión…</span>
      </div>
    );
  }

  if (seedErr && !substantiveMarkupDoc && docxSeed === EMPTY_DOC) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{seedErr}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-slate-200/95 bg-slate-200/55 p-3 sm:p-5">
        <div
          className="despacho-borrador-hoja w-full max-w-none bg-white font-serif shadow-[0_2px_16px_rgba(15,23,42,0.07)] ring-1 ring-slate-300/75"
          style={padRichCuerpo}
        >
          <MembreteRichPreview membrete={membrete} embedded />
          <div className="mt-0 min-w-0 pt-1 text-slate-900">
            <div className="flex w-full min-w-0 flex-col gap-0 lg:min-h-[min(60vh,28rem)] lg:flex-row lg:items-stretch">
              <div className="flex min-h-0 min-w-0 w-full flex-col border-slate-300/70 lg:w-[70%] lg:flex-shrink-0 lg:border-r">
                {bodyEditor && puedeEditar ? (
                  <BubbleMenu
                    editor={bodyEditor}
                    shouldShow={({ editor: ed }) => !ed.state.selection.empty}
                    options={{ placement: 'bottom-start' }}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={focusWordReviewCommentBox}
                      className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-900 shadow-md hover:bg-violet-50"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Comentario en el margen
                    </button>
                  </BubbleMenu>
                ) : null}
                <JudicialDocEditor
                  ref={judicialRef}
                  unframed
                  despachoSheetChrome
                  content={editorContent}
                  onChange={(json) => scheduleSave(json)}
                  readOnly={!puedeEditar}
                  showComments
                  hideInlineCommentBubble
                  onEditorReady={setBodyEditor}
                  placeholder="El juez puede anotar observaciones aquí..."
                  minHeight="600px"
                  className="tiptap-template-focus min-w-0 px-0"
                />
              </div>
              <div className="flex min-h-[min(36vh,16rem)] w-full min-w-0 flex-col lg:min-h-0 lg:w-[30%] lg:flex-shrink-0">
                <TiptapDespachoReviewChrome
                  editor={bodyEditor}
                  disabled={!puedeEditar}
                  displayName={reviewActorDisplayName}
                  threads={commentThreads}
                  onThreadsChange={(next) => {
                    setCommentThreads(next);
                    commentThreadsRef.current = next;
                    const ed = judicialRef.current?.getEditor();
                    if (ed && puedeEditar && onDebouncedSave) scheduleSave(ed.getJSON());
                  }}
                  editorDomIdSuffix={commentRailDomIdSuffix}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {seedErr ? (
        <p className="rounded-lg border border-amber-100 bg-amber-50/90 px-3 py-2 text-[10px] text-amber-950">
          Aviso: {seedErr} — puede editar sobre el contenido recuperado.
        </p>
      ) : null}

      {puedeEditar ? (
        <p className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-[10px] text-slate-500">
          Los cambios se guardan solos en Jurion (unos segundos después de escribir). El .docx del expediente no se
          modifica aquí: para enviar correcciones al archivo Word use descarga, edición en Word y nueva carga al
          expediente.
        </p>
      ) : null}
    </div>
  );
}

export function parseReviewMarkupPayload(raw: unknown): ReviewMarkupPayloadV1 | null {
  if (!isPayloadV1(raw)) return null;
  return raw;
}
