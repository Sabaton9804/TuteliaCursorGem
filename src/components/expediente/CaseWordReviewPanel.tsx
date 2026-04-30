import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Gavel, Loader2, RefreshCw, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { CaseWordReview, Document, UserProfile, UserRole, WordReviewStatus } from '../../types';
import { caseDocumentRawLabel } from '../../lib/case-document-display-name';
import { sanitizeExpedienteFilenameForDisplay } from '../../lib/sanitize-expediente-filename';
import { isCaseDocumentDocx, isCaseDocumentPdf } from '../../lib/expediente-docx';
import {
  createCaseWordReview,
  fetchCaseWordReviews,
  updateCaseWordReview,
} from '../../lib/case-word-reviews';

type Props = {
  caseId: string;
  docs: Document[];
  profile: UserProfile | null;
  onRefetchDocs: () => void | Promise<void>;
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

const STATUS_LABEL: Record<WordReviewStatus, string> = {
  pendiente_juez: 'Pendiente de revisión (despacho)',
  observaciones_juez: 'Con observaciones — corrección de borrador',
  aprobado_firma_pendiente: 'Aprobado — falta PDF firmado',
  cerrado_con_pdf_firmado: 'Cerrado con PDF firmado',
};

function docLabel(d: Document): string {
  return sanitizeExpedienteFilenameForDisplay(caseDocumentRawLabel(d));
}

export function CaseWordReviewPanel({ caseId, docs, profile, onRefetchDocs }: Props) {
  const [rows, setRows] = useState<CaseWordReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newWordId, setNewWordId] = useState('');
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [draftReply, setDraftReply] = useState<Record<string, string>>({});
  const [draftNewWord, setDraftNewWord] = useState<Record<string, string>>({});
  const [draftPdf, setDraftPdf] = useState<Record<string, string>>({});

  const role = profile?.role;
  const puedeDespacho = roleCanOpenReview(role);

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
              Quien revise (juez, asistente, etc.) usa la vista previa del expediente, deja{' '}
              <strong className="text-slate-800">apuntes</strong> y devuelve o aprueba; la edición fina del documento sigue
              en Word descargado.
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

            return (
              <article key={r.id} className="card-modern overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      <FileText className="h-3.5 w-3.5" />
                      {wordDoc ? docLabel(wordDoc) : 'Documento Word'}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-indigo-900">{STATUS_LABEL[r.status]}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">#{r.id.slice(0, 8)}</p>
                  </div>
                </div>

                <div className="space-y-4 px-5 py-4">
                  {r.status === 'pendiente_juez' ? (
                    <div className="space-y-3">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Apuntes / observaciones para corrección del borrador
                        <textarea
                          value={notes}
                          onChange={(e) => setDraftNotes((s) => ({ ...s, [r.id]: e.target.value }))}
                          rows={5}
                          className="input-modern mt-1 w-full resize-y text-sm"
                          placeholder="Ej.: Ajustar el encabezado; citar jurisprudencia X; corregir el numeral 3…"
                          disabled={busy}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy || !notes.trim()}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await updateCaseWordReview(r.id, {
                                judgeNotes: notes.trim(),
                                status: 'observaciones_juez',
                              });
                              await refreshAll();
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
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await updateCaseWordReview(r.id, {
                                judgeNotes: notes.trim() || null,
                                status: 'aprobado_firma_pendiente',
                              });
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
