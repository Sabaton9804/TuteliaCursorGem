import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileDown, FileText, Gavel, Loader2, RefreshCw, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getCachedNameByRole } from '../../lib/court-staff-cache';
import { downloadCaseDocxFromStoragePath } from '../../lib/download-case-docx';
import type {
  Case,
  CaseWordReview,
  CaseWordReviewMarkupV1,
  Document,
  UserProfile,
  UserRole,
  WordReviewStatus,
} from '../../types';
import {
  insertWordReviewSustanciadorNotifications,
  type WordReviewSustanciadorNotifyCaseContext,
} from '../../lib/word-review-notifications';
import { applyStageTransitionFalloPdfFirmado, applyStageTransitionJudgeApprovedBorrador } from '../../lib/case-stages-service';
import { hasRoleCapability } from '../../lib/role-capabilities';
import { docToStorage, parseStorageToDoc } from '../../lib/tiptap-template-storage';
import { ensureTipTapDocJSON, isTipTapDocSubstantivelyEmpty } from '../../lib/docx-to-tiptap-review-seed';
import type { JSONContent } from '@tiptap/core';
import { caseDocumentRawLabel } from '../../lib/case-document-display-name';
import { sanitizeExpedienteFilenameForDisplay } from '../../lib/sanitize-expediente-filename';
import { isCaseDocumentDocx, isCaseDocumentPdf } from '../../lib/expediente-docx';
import {
  createCaseWordReview,
  fetchCaseWordReviews,
  updateCaseWordReview,
} from '../../lib/case-word-reviews';
import { ensureSupabaseSessionForWrites } from '../../lib/supabase-write-auth';
import { fetchCourtBranding } from '../../lib/court-branding';
import type { PlantillasStateV2 } from '../../lib/plantillas-store';
import { loadPlantillas } from '../../lib/plantillas-store';
import {
  WordReviewRichEditor,
  type WordReviewMarkupSavePayload,
  type WordReviewRichSaverApi,
} from './WordReviewRichEditor';
import type { CommentThreadsMap } from '../../lib/review-markup-payload';

type Props = {
  caseId: string;
  docs: Document[];
  profile: UserProfile | null;
  onRefetchDocs: () => void | Promise<void>;
  /** Tras aprobar borrador: actualizar expediente (p. ej. plazo / etapas). */
  onRefetchCase?: () => void | Promise<void>;
  /** Reservados para la vista integrada con expediente y membrete (restaurar desde historial local si faltan). */
  caseItem?: Case | null;
  courtId?: string;
  notifyCaseContext?: WordReviewSustanciadorNotifyCaseContext | null;
};

/** Perfiles que ven «Documentos por revisar» y pueden avanzar cualquier paso (carga en expediente la hace el mismo conjunto). */
function roleCanOpenReview(role: UserRole | undefined): boolean {
  if (!role) return false;
  return (
    role === 'admin' ||
    role === 'sustanciador' ||
    role === 'clerk' ||
    role === 'escribiente' ||
    role === 'official' ||
    role === 'judge' ||
    role === 'asistente_judicial'
  );
}

function roleCanApproveBorrador(role: UserRole | undefined): boolean {
  return hasRoleCapability(role, 'aprobar_borrador_juez');
}

/** Edición TipTap en «pendiente de juez»: juez, asistente judicial o administrador (pruebas / soporte). */
function roleCanEditPendingJudgeReview(role: UserRole | undefined): boolean {
  if (!role) return false;
  return role === 'judge' || role === 'asistente_judicial' || role === 'admin';
}

const STATUS_LABEL: Record<WordReviewStatus, string> = {
  pendiente_juez: 'Pendiente de revisión (despacho)',
  observaciones_juez: 'Con observaciones — corrección de borrador',
  aprobado_firma_pendiente: 'Aprobado — falta PDF firmado',
  cerrado_con_pdf_firmado: 'Cerrado con PDF firmado',
};

function docLabel(d: Document): string {
  return sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(d));
}

function docFromMarkupStorageString(raw: string): JSONContent {
  const t = raw.trim();
  if (!t) return { type: 'doc', content: [{ type: 'paragraph' }] };
  if (t.startsWith('tiptap:')) return parseStorageToDoc(t);
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as JSONContent;
      if (j?.type === 'doc') return ensureTipTapDocJSON(j);
    } catch {
      /* seguir */
    }
  }
  return parseStorageToDoc(t);
}

function reviewMarkupRowToStorageString(m: CaseWordReview['reviewMarkupJson']): string {
  if (!m) return '';

  const fromDoc = (): string => {
    if (!m.doc) return '';
    try {
      return docToStorage(ensureTipTapDocJSON(m.doc as JSONContent));
    } catch {
      return '';
    }
  };

  const st = m.storage as unknown;
  if (typeof st === 'string' && st.trim()) {
    const trimmed = st.trim();
    const parsed = docFromMarkupStorageString(trimmed);
    if (!isTipTapDocSubstantivelyEmpty(parsed)) return trimmed;
    const d = fromDoc();
    if (d) return d;
    return trimmed;
  }
  if (st && typeof st === 'object' && !Array.isArray(st)) {
    try {
      return docToStorage(ensureTipTapDocJSON(st as JSONContent));
    } catch {
      return fromDoc();
    }
  }
  return fromDoc();
}

function reviewMarkupCommentThreads(
  m: CaseWordReview['reviewMarkupJson'],
): CommentThreadsMap | undefined {
  const raw = m?.commentThreads;
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as CommentThreadsMap;
}

function hasCommentThreadsWithReplies(threads?: CommentThreadsMap): boolean {
  if (!threads) return false;
  return Object.values(threads).some((t) => Array.isArray(t?.replies) && t.replies.length > 0);
}

function hasMeaningfulReviewMarkup(row: CaseWordReview): boolean {
  if (hasCommentThreadsWithReplies(reviewMarkupCommentThreads(row.reviewMarkupJson))) return true;
  const s = reviewMarkupRowToStorageString(row.reviewMarkupJson);
  if (!s.trim()) return false;
  try {
    return !isTipTapDocSubstantivelyEmpty(docFromMarkupStorageString(s));
  } catch {
    return s.length > 90;
  }
}

function judgeNameForReview(): string {
  return getCachedNameByRole('judge') || '—';
}

export function CaseWordReviewPanel({
  caseId,
  docs,
  profile,
  onRefetchDocs,
  onRefetchCase,
  caseItem,
  courtId = '',
  notifyCaseContext,
}: Props) {
  const [rows, setRows] = useState<CaseWordReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newWordId, setNewWordId] = useState('');
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [draftReply, setDraftReply] = useState<Record<string, string>>({});
  const [draftNewWord, setDraftNewWord] = useState<Record<string, string>>({});
  const [draftPdf, setDraftPdf] = useState<Record<string, string>>({});
  const [docxDownloadFor, setDocxDownloadFor] = useState<string | null>(null);
  const reviewFlushRef = useRef<Record<string, WordReviewRichSaverApi | null>>({});
  const [membreteState, setMembreteState] = useState<PlantillasStateV2>(() => loadPlantillas());

  const role = profile?.role;
  const puedeDespacho = roleCanOpenReview(role);
  const canApproveBorrador = roleCanApproveBorrador(role);

  const docxDocs = useMemo(() => docs.filter((d) => isCaseDocumentDocx(d)), [docs]);
  const pdfDocs = useMemo(() => docs.filter((d) => isCaseDocumentPdf(d)), [docs]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await fetchCaseWordReviews(caseId);
      setRows(list);
      setDraftNotes((prev) => {
        const next = { ...prev };
        for (const r of list) {
          if (next[r.id] === undefined && r.judgeNotes) next[r.id] = r.judgeNotes;
        }
        return next;
      });
      setDraftReply((prev) => {
        const next = { ...prev };
        for (const r of list) {
          if (next[r.id] === undefined && r.sustanciadorReply) next[r.id] = r.sustanciadorReply;
        }
        return next;
      });
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : 'No se cargaron revisiones. Ejecute la migración SQL «case_word_reviews» en Supabase y recargue.',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const cid = courtId.trim();
    if (!cid) {
      setMembreteState(loadPlantillas());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const m = await fetchCourtBranding(cid);
        if (!cancelled) setMembreteState({ version: 3, membrete: m });
      } catch {
        if (!cancelled) setMembreteState(loadPlantillas());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courtId]);

  useEffect(() => {
    if (!caseId) return;
    const ch = supabase
      .channel(`case-word-reviews-${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_word_reviews', filter: `case_id=eq.${caseId}` },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [caseId, load]);

  const refreshAll = async () => {
    await load();
    await onRefetchDocs();
  };

  const persistReviewMarkup = useCallback(async (reviewId: string, patch: WordReviewMarkupSavePayload) => {
    const trimmed = patch.storage.trim();
    const threads = patch.commentThreads;
    const payload: CaseWordReviewMarkupV1 | null = trimmed
      ? {
          v: 1,
          storage: trimmed,
          ...(threads && Object.keys(threads).length > 0 ? { commentThreads: threads } : {}),
        }
      : null;
    try {
      await updateCaseWordReview(reviewId, { reviewMarkupJson: payload });
      setRows((prev) =>
        prev.map((row) => (row.id === reviewId ? { ...row, reviewMarkupJson: payload ?? undefined } : row)),
      );
      return payload ?? undefined;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo guardar la revisión en Tutelia.';
      setErr(msg);
      throw e;
    }
  }, []);

  if (!puedeDespacho) {
    return (
      <div className="card-modern p-6 text-sm text-slate-600">
        Su perfil no tiene acceso a «Documentos por revisar». Use un usuario del despacho (juez, asistente judicial,
        sustanciador, secretaría, etc.) o administrador.
      </div>
    );
  }

  const handleCreate = async () => {
    if (!newWordId) return;
    setBusy(true);
    setErr(null);
    try {
      await createCaseWordReview(caseId, newWordId);
      setNewWordId('');
      await refreshAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo crear la revisión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card-modern overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-indigo-50/40 px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Gavel className="h-5 w-5 text-indigo-600" aria-hidden />
            Documentos por revisar (despacho)
          </h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-600">
            <li>
              Cualquier miembro del despacho con acceso carga el <strong className="text-slate-800">.docx</strong> en{' '}
              <strong className="text-slate-800">Expediente digital</strong> e <strong className="text-slate-800">inicia</strong>{' '}
              un ciclo aquí.
            </li>
            <li>
              Quien revise abre el <strong className="text-slate-800">.docx en Microsoft Word</strong> (revisión, comentarios,
              control de cambios), guarda si aplica y deja <strong className="text-slate-800">apuntes</strong> en esta pantalla
              para devolver o aprobar. La vista HTML es solo orientativa.
            </li>
            <li>
              Tras observaciones, se sube una <strong className="text-slate-800">nueva versión</strong> del Word al
              expediente y se vincula aquí al mismo ciclo.
            </li>
            <li>
              Tras <strong className="text-slate-800">aprobar</strong>, el PDF firmado se sube al expediente (p. ej. lo
              carga secretaría) y <strong className="text-slate-800">cualquiera del despacho</strong> puede vincularlo
              aquí para cerrar.
            </li>
          </ol>
        </div>

        {puedeDespacho ? (
          <div className="border-b border-slate-100 px-6 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nuevo ciclo de revisión</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-[11px] font-semibold text-slate-600">
                Documento Word en expediente
                <select
                  value={newWordId}
                  onChange={(e) => setNewWordId(e.target.value)}
                  className="input-modern mt-1 w-full text-sm"
                  disabled={busy}
                >
                  <option value="">— Seleccione un .doc/.docx ya cargado —</option>
                  {docxDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {docLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !newWordId}
                onClick={() => void handleCreate()}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Iniciar revisión
              </button>
            </div>
            {docxDocs.length === 0 ? (
              <p className="mt-2 text-[11px] text-amber-800">
                Aún no hay Word en el expediente. Suba un .docx en la pestaña «Expediente digital».
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 px-6 py-3">
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={busy || loading}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-accent disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm font-medium">Cargando…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="card-modern p-8 text-center text-sm text-slate-500">
          No hay ciclos en curso. Inicie uno con un documento Word ya cargado en el expediente.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const wordDoc = docs.find((d) => d.id === r.wordDocumentId);
            const pdfDoc = r.signedPdfDocumentId ? docs.find((d) => d.id === r.signedPdfDocumentId) : null;
            const notes = draftNotes[r.id] ?? r.judgeNotes ?? '';
            const reply = draftReply[r.id] ?? r.sustanciadorReply ?? '';
            const newWordPick = draftNewWord[r.id] ?? '';
            const pdfPick = draftPdf[r.id] ?? '';
            const puedeEditarRevision =
              r.status === 'pendiente_juez' && roleCanEditPendingJudgeReview(role);

            return (
              <article key={r.id} className="card-modern overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      <FileText className="h-3.5 w-3.5" />
                      {wordDoc ? docLabel(wordDoc) : 'Documento Word'}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-indigo-900">{STATUS_LABEL[r.status]}</p>
                    <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                      Revisión judicial de referencia:{' '}
                      <span className="font-semibold text-slate-700">{judgeNameForReview()}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="break-all font-mono text-[10px] text-slate-500" title="UUID de la fila case_word_reviews">
                        Revisión (SQL): <span className="text-slate-700">{r.id}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(r.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100"
                      >
                        <Copy className="h-3 w-3" />
                        Copiar id
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 px-5 py-4">
                  {wordDoc?.storagePath?.trim() ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Borrador en Word (revisión real)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Boolean(docxDownloadFor) || busy}
                          onClick={() => {
                            void (async () => {
                              setDocxDownloadFor(r.id);
                              setErr(null);
                              try {
                                await downloadCaseDocxFromStoragePath(wordDoc.storagePath!, docLabel(wordDoc));
                              } catch (e) {
                                setErr(e instanceof Error ? e.message : 'No se pudo descargar el Word.');
                              } finally {
                                setDocxDownloadFor(null);
                              }
                            })();
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-40"
                        >
                          {docxDownloadFor === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileDown className="h-3.5 w-3.5" />
                          )}
                          Descargar y abrir en Word
                        </button>
                        <p className="w-full text-[10px] leading-snug text-slate-500">
                          El formato fiel al Word (membrete, márgenes, impresión) lo obtiene con{' '}
                          <strong className="font-semibold text-slate-700">Descargar y abrir en Word</strong>. La
                          revisión en Tutelia es un solo editor sobre el texto convertido desde ese archivo (sin segunda
                          vista HTML del mismo documento aquí).
                        </p>
                      </div>
                      {r.status !== 'observaciones_juez' ? (
                        <div className="space-y-2 border-t border-slate-100 pt-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-700">
                            {r.status === 'pendiente_juez'
                              ? 'Revisión integral en Tutelia'
                              : 'Revisión en Tutelia (referencia)'}
                          </p>
                          <p className="text-[10px] leading-snug text-slate-600">
                            {r.status === 'pendiente_juez' ? (
                              <>
                                Edite el texto, use subrayado y resaltado, y añada{' '}
                                <strong className="font-semibold text-slate-800">comentarios</strong> con el globo al
                                seleccionar un fragmento. Se guarda automáticamente en la plataforma (no modifica el
                                .docx del expediente).
                              </>
                            ) : (
                              <>Vista de lo guardado en Tutelia en esta etapa (solo lectura).</>
                            )}
                          </p>
                          <WordReviewRichEditor
                            key={r.id}
                            storagePath={wordDoc.storagePath}
                            reviewMarkup={reviewMarkupRowToStorageString(r.reviewMarkupJson)}
                            reviewMarkupJsonAbsent={r.reviewMarkupJson == null}
                            membrete={membreteState.membrete}
                            reviewActorDisplayName={
                              profile?.name?.trim() || profile?.email?.trim() || null
                            }
                            commentRailDomIdSuffix={r.id}
                            initialCommentThreads={reviewMarkupCommentThreads(r.reviewMarkupJson)}
                            puedeEditar={puedeEditarRevision}
                            devAuth={
                              import.meta.env.DEV ? { role, status: r.status } : undefined
                            }
                            onDebouncedSave={(payload) => persistReviewMarkup(r.id, payload)}
                            registerSaverApi={(api) => {
                              reviewFlushRef.current[r.id] = api;
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : wordDoc ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-950">
                      Este Word no tiene ruta en almacenamiento; no se puede previsualizar ni abrir desde aquí. Revise el
                      expediente digital o vuelva a cargar el .docx.
                    </p>
                  ) : null}

                  {r.status === 'pendiente_juez' ? (
                    <div className="space-y-3">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Resumen en texto libre (opcional si ya dejó comentarios en el editor superior)
                        <textarea
                          value={notes}
                          onChange={(e) => setDraftNotes((s) => ({ ...s, [r.id]: e.target.value }))}
                          rows={4}
                          className="input-modern mt-1 w-full resize-y text-sm"
                          placeholder="Ej.: Ajustar el encabezado; citar jurisprudencia X; corregir el numeral 3…"
                          disabled={busy}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy || (!notes.trim() && !hasMeaningfulReviewMarkup(r))}
                          onClick={async () => {
                            setBusy(true);
                            setErr(null);
                            try {
                              const flushed = await reviewFlushRef.current[r.id]?.flush?.();
                              const rowForRule = flushed ? { ...r, reviewMarkupJson: flushed } : r;
                              if (!notes.trim() && !hasMeaningfulReviewMarkup(rowForRule)) {
                                setErr(
                                  'Indique observaciones: texto libre arriba o comentarios/edición en «Revisión integral en Tutelia» (pulse otra vez si acaba de escribir allí).',
                                );
                                return;
                              }
                              if (import.meta.env.DEV) {
                                console.log('[Devolver observaciones] inicio', {
                                  reviewId: r.id,
                                  notesLen: notes.trim().length,
                                  hasMarkup: hasMeaningfulReviewMarkup(rowForRule),
                                });
                              }
                              await updateCaseWordReview(r.id, {
                                judgeNotes: notes.trim() || null,
                                status: 'observaciones_juez',
                              });
                              if (import.meta.env.DEV) {
                                console.log('[Devolver observaciones] updateCaseWordReview OK');
                              }
                              setRows((prev) =>
                                prev.map((row) =>
                                  row.id === r.id
                                    ? {
                                        ...row,
                                        status: 'observaciones_juez',
                                        judgeNotes: notes.trim() || undefined,
                                      }
                                    : row,
                                ),
                              );
                              await refreshAll();
                              if (import.meta.env.DEV) {
                                console.log('[Devolver observaciones] refreshAll OK');
                              }
                              if (notifyCaseContext) {
                                try {
                                  await ensureSupabaseSessionForWrites();
                                  const actor =
                                    profile?.name?.trim() ||
                                    profile?.email?.trim() ||
                                    'Usuario';
                                  const docLabelText = wordDoc ? docLabel(wordDoc) : 'Documento Word';
                                  await insertWordReviewSustanciadorNotifications(supabase, {
                                    caseContext: notifyCaseContext,
                                    caseId,
                                    reviewId: r.id,
                                    documentLabel: docLabelText,
                                    actorUserName: actor,
                                    reviewCreatedBy: r.createdBy,
                                  });
                                  if (import.meta.env.DEV) {
                                    console.log('[Devolver observaciones] notificación sustanciador OK');
                                  }
                                } catch (ne) {
                                  console.error('[Devolver observaciones] notificación falló (el estado ya se guardó):', ne);
                                  setErr(
                                    ne instanceof Error
                                      ? `Estado actualizado; aviso al sustanciador falló: ${ne.message}`
                                      : 'Estado actualizado; no se pudo enviar el aviso al sustanciador.',
                                  );
                                }
                              }
                            } catch (e) {
                              setErr(e instanceof Error ? e.message : 'Error al guardar.');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-amber-700 disabled:opacity-40"
                        >
                          Devolver con observaciones
                        </button>
                        <button
                          type="button"
                          disabled={busy || !canApproveBorrador}
                          title={
                            canApproveBorrador
                              ? undefined
                              : 'Solo el juez o asistente judicial puede aprobar borradores.'
                          }
                          onClick={async () => {
                            setBusy(true);
                            setErr(null);
                            try {
                              await reviewFlushRef.current[r.id]?.flush?.();
                              await updateCaseWordReview(r.id, {
                                judgeNotes: notes.trim() || null,
                                status: 'aprobado_firma_pendiente',
                              });
                              if (courtId && caseItem?.id) {
                                const wordDoc = docs.find((d) => d.id === r.wordDocumentId);
                                try {
                                  await applyStageTransitionJudgeApprovedBorrador(supabase, {
                                    caseId,
                                    courtId,
                                    radicado: caseItem.radicado,
                                    caseType: caseItem.caseType ?? 'tutela_primera',
                                    caseAssignedTo: caseItem.assignedTo,
                                    wordDocumentType: wordDoc?.type,
                                  });
                                } catch (se) {
                                  console.error('Cambio de etapa automático:', se);
                                  setErr(
                                    se instanceof Error
                                      ? `Borrador aprobado, pero no se actualizó la etapa: ${se.message}`
                                      : 'Borrador aprobado, pero no se pudo actualizar la etapa procesal.',
                                  );
                                }
                                await onRefetchCase?.();
                              }
                              await refreshAll();
                            } catch (e) {
                              setErr(e instanceof Error ? e.message : 'Error al aprobar.');
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-emerald-800 disabled:opacity-40"
                        >
                          Aprobar borrador (siguiente: PDF firmado)
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {r.status === 'observaciones_juez' ? (
                    <div className="space-y-3">
                      {wordDoc?.storagePath?.trim() ? (
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Revisión en Tutelia (guardada)
                          </p>
                          <WordReviewRichEditor
                            key={`${r.id}-readonly`}
                            storagePath={wordDoc.storagePath}
                            reviewMarkup={reviewMarkupRowToStorageString(r.reviewMarkupJson)}
                            reviewMarkupJsonAbsent={r.reviewMarkupJson == null}
                            membrete={membreteState.membrete}
                            reviewActorDisplayName={
                              profile?.name?.trim() || profile?.email?.trim() || null
                            }
                            commentRailDomIdSuffix={`${r.id}-readonly`}
                            initialCommentThreads={reviewMarkupCommentThreads(r.reviewMarkupJson)}
                            puedeEditar={false}
                            devAuth={
                              import.meta.env.DEV ? { role, status: r.status } : undefined
                            }
                          />
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
                        <p className="font-bold text-amber-900">Observaciones registradas</p>
                        <p className="mt-1 whitespace-pre-wrap">{r.judgeNotes?.trim() || '—'}</p>
                      </div>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Respuesta / comentario interno (opcional)
                        <textarea
                          value={reply}
                          onChange={(e) => setDraftReply((s) => ({ ...s, [r.id]: e.target.value }))}
                          rows={2}
                          className="input-modern mt-1 w-full resize-y text-sm"
                          disabled={busy}
                        />
                      </label>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Nueva versión Word (ya cargada en expediente)
                        <select
                          value={newWordPick}
                          onChange={(e) => setDraftNewWord((s) => ({ ...s, [r.id]: e.target.value }))}
                          className="input-modern mt-1 w-full text-sm"
                          disabled={busy}
                        >
                          <option value="">— Mantener versión actual —</option>
                          {docxDocs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {docLabel(d)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={busy || !newWordPick}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await updateCaseWordReview(r.id, {
                              wordDocumentId: newWordPick,
                              sustanciadorReply: reply.trim() || null,
                              status: 'pendiente_juez',
                            });
                            setDraftNewWord((s) => ({ ...s, [r.id]: '' }));
                            await refreshAll();
                          } catch (e) {
                            setErr(e instanceof Error ? e.message : 'Error al reenviar.');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        Reenviar versión corregida a revisión
                      </button>
                    </div>
                  ) : null}

                  {r.status === 'aprobado_firma_pendiente' ? (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-600">
                        Suba el PDF firmado en «Expediente digital» (puede hacerlo secretaría u otra área) y selecciónelo
                        aquí para cerrar el ciclo.
                      </p>
                      <label className="block text-[11px] font-semibold text-slate-700">
                        PDF firmado en expediente
                        <select
                          value={pdfPick}
                          onChange={(e) => setDraftPdf((s) => ({ ...s, [r.id]: e.target.value }))}
                          className="input-modern mt-1 w-full text-sm"
                          disabled={busy}
                        >
                          <option value="">— Seleccione PDF —</option>
                          {pdfDocs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {docLabel(d)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={busy || !pdfPick}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await updateCaseWordReview(r.id, {
                              signedPdfDocumentId: pdfPick,
                              status: 'cerrado_con_pdf_firmado',
                            });
                            if (courtId && caseItem?.id) {
                              const wordDoc = docs.find((d) => d.id === r.wordDocumentId);
                              const isFalloOSentencia =
                                wordDoc?.type === 'borrador_sentencia_revision' ||
                                (wordDoc?.type?.includes('fallo') && wordDoc?.type?.includes('revision'));
                              if (isFalloOSentencia) {
                                try {
                                  await applyStageTransitionFalloPdfFirmado(supabase, {
                                    caseId,
                                    courtId,
                                    radicado: caseItem.radicado,
                                    caseType: caseItem.caseType ?? 'tutela_primera',
                                    caseAssignedTo: caseItem.assignedTo,
                                  });
                                } catch (se) {
                                  console.error('Cambio de etapa fallo PDF firmado:', se);
                                }
                                await onRefetchCase?.();
                              }
                            }
                            setDraftPdf((s) => ({ ...s, [r.id]: '' }));
                            await refreshAll();
                          } catch (e) {
                            setErr(e instanceof Error ? e.message : 'Error al cerrar.');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-40"
                      >
                        Vincular PDF firmado y cerrar
                      </button>
                    </div>
                  ) : null}

                  {r.status === 'cerrado_con_pdf_firmado' ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-950">
                      <p className="font-bold">Ciclo cerrado</p>
                      <p className="mt-1">
                        Word: <span className="font-mono">{wordDoc ? docLabel(wordDoc) : r.wordDocumentId}</span>
                      </p>
                      <p className="mt-1">
                        PDF firmado:{' '}
                        <span className="font-mono">
                          {pdfDoc ? docLabel(pdfDoc) : r.signedPdfDocumentId || '—'}
                        </span>
                      </p>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
