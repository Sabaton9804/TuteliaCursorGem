import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { motion } from 'motion/react';
import {
  Check,
  ChevronRight,
  ClipboardList,
  Eye,
  Loader2,
  Mail,
  X,
  AlertCircle,
  FileText,
} from 'lucide-react';
import {
  approveOutlookReview,
  fetchOutlookAttachmentBytes,
  fetchOutlookReviews,
  rejectOutlookReview,
  type OutlookAttachmentMeta,
  type OutlookMessageReview,
  type OutlookProposedIngestPiece,
} from '../lib/outlook-api';
import { CasePdfViewer } from '../components/new-case/CasePdfViewer';
import { formatRadicado } from '../lib/formatters';
import {
  etiquetaVinculo,
  mensajeVinculo,
  puedeAprobarIngreso,
  vinculoFromClassification,
} from '../lib/outlook-expediente-vinculo';

const TIPO_LABELS: Record<string, string> = {
  reparto_nuevo: 'Reparto nuevo',
  respuesta_tramite: 'Respuesta en trámite',
  impugnacion: 'Impugnación',
  otro: 'Otro',
};

const CONFIANZA_STYLES: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-800',
  media: 'bg-amber-100 text-amber-800',
  baja: 'bg-slate-200 text-slate-700',
};

function formatReviewDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), "d MMM yyyy, HH:mm", { locale: es });
  } catch {
    return iso;
  }
}

function manifestForAttachmentPiece(
  review: OutlookMessageReview,
  piece: OutlookProposedIngestPiece & { kind: 'attachment' }
): OutlookAttachmentMeta | undefined {
  const byName = review.attachment_manifest.find(
    (a) => a.name === piece.name || a.name === piece.label
  );
  if (byName) return byName;
  const proposedAtts = review.proposed_ingest.filter((p) => p.kind === 'attachment');
  const idx = proposedAtts.findIndex((p) => p.sessionIndex === piece.sessionIndex);
  return idx >= 0 ? review.attachment_manifest[idx] : undefined;
}

function CorreoIngestPiecePreview({
  review,
  piece,
}: {
  review: OutlookMessageReview;
  piece: OutlookProposedIngestPiece;
}) {
  const [outlookBytes, setOutlookBytes] = useState<Uint8Array | null>(null);
  const [outlookLoading, setOutlookLoading] = useState(false);
  const [outlookError, setOutlookError] = useState<string | null>(null);

  const bodyPreview = review.classification?.body_preview?.trim() || '';

  useEffect(() => {
    if (piece.kind !== 'attachment') {
      setOutlookBytes(null);
      setOutlookError(null);
      setOutlookLoading(false);
      return;
    }
    if (review.parse_session_id) {
      setOutlookBytes(null);
      setOutlookError(null);
      setOutlookLoading(false);
      return;
    }
    const manifest = manifestForAttachmentPiece(review, piece);
    if (!manifest) {
      setOutlookError('No se encontró el adjunto en el manifiesto del correo.');
      return;
    }
    let cancelled = false;
    setOutlookLoading(true);
    setOutlookError(null);
    void (async () => {
      try {
        const bytes = await fetchOutlookAttachmentBytes(review.outlook_message_id, manifest);
        if (!cancelled) setOutlookBytes(bytes);
      } catch (e) {
        if (!cancelled) {
          setOutlookError(e instanceof Error ? e.message : 'No se pudo descargar el adjunto.');
        }
      } finally {
        if (!cancelled) setOutlookLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [piece, review.id, review.outlook_message_id, review.parse_session_id]);

  if (piece.kind === 'email_body') {
    return (
      <div className="rounded-xl border border-slate-100 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Constancia del correo
        </p>
        {bodyPreview ? (
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
            {bodyPreview.slice(0, 12000)}
          </pre>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            Se generará al aprobar el ingreso (metadatos y cuerpo del mensaje).
          </p>
        )}
      </div>
    );
  }

  if (!review.parse_session_id) {
    if (outlookLoading) {
      return (
        <p className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Descargando adjunto desde Outlook…
        </p>
      );
    }
    if (outlookError) {
      return (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {outlookError}
        </p>
      );
    }
    if (outlookBytes?.length) {
      return (
        <div className="h-72 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
          <CasePdfViewer
            pdfBytes={outlookBytes}
            contentType={piece.contentType}
            filename={piece.label || piece.name}
            displayMode="scroll"
          />
        </div>
      );
    }
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Sesión de análisis no disponible. Vuelva a «Correo» y use «Analizar con IA» en este mensaje.
      </p>
    );
  }

  return (
    <div className="h-72 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
      <CasePdfViewer
        parseSessionId={review.parse_session_id}
        sessionIndex={piece.sessionIndex}
        contentType={piece.contentType}
        filename={piece.label || piece.name}
        displayMode="scroll"
      />
    </div>
  );
}

export default function CorreoPendientes() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<OutlookMessageReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [previewPieceIndex, setPreviewPieceIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchOutlookReviews('pending');
      setReviews(list);
      setSelectedId((prev) =>
        prev && list.some((r) => r.id === prev) ? prev : list[0]?.id ?? null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar pendientes.');
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = reviews.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    setPreviewPieceIndex(0);
  }, [selectedId]);

  useEffect(() => {
    if (!selected) {
      setSelectedCaseId('');
      return;
    }
    const cls = selected.classification;
    const proposed =
      selected.proposed_case_id ||
      cls?.expediente_vinculado_id ||
      (cls?.vinculo_expediente === 'encontrado' ? cls.casos_candidatos?.[0]?.id : '') ||
      '';
    setSelectedCaseId(proposed || '');
  }, [selected?.id, selected?.proposed_case_id, selected?.classification]);

  const handleApprove = async () => {
    if (!selected) return;
    if (!puedeAprobarIngreso(selected.classification, selectedCaseId)) {
      setError(mensajeVinculo(selected.classification));
      return;
    }
    if (!selectedCaseId) {
      setError('Seleccione el expediente destino.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { caseId, ingest } = await approveOutlookReview(selected.id, selectedCaseId);
      setBanner(
        `Ingresadas ${ingest.documentsCreated} pieza(s) al expediente. Puede revisarlas en el expediente digital.`
      );
      const next = reviews.filter((r) => r.id !== selected.id);
      setReviews(next);
      setSelectedId(next[0]?.id ?? null);
      navigate(`/case/${caseId}?tab=expediente`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar el ingreso.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await rejectOutlookReview(selected.id);
      setBanner('Correo descartado de la cola de pendientes.');
      const next = reviews.filter((r) => r.id !== selected.id);
      setReviews(next);
      setSelectedId(next[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo descartar.');
    } finally {
      setBusy(false);
    }
  };

  const cls = selected?.classification;
  const vinculo = cls ? vinculoFromClassification(cls) : 'no_aplica';
  const aprobarOk = cls ? puedeAprobarIngreso(cls, selectedCaseId) : false;

  const vinculoBoxClass =
    vinculo === 'encontrado'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : vinculo === 'no_encontrado'
        ? 'border-red-200 bg-red-50 text-red-950'
        : vinculo === 'ambiguo'
          ? 'border-amber-200 bg-amber-50 text-amber-950'
          : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-6xl space-y-6"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-violet-700">
            <ClipboardList className="h-4 w-4" aria-hidden />
            Revisión de correo
          </p>
          <h1 className="text-2xl font-bold text-slate-900">Pendientes de ingreso</h1>
          <p className="mt-1 text-sm text-slate-500">
            El sistema analizó cada correo y propone el expediente y las piezas. Usted aprueba o descarta.
          </p>
        </div>
        <Link
          to="/correo"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50"
        >
          <Mail className="h-4 w-4" />
          Bandeja Outlook
        </Link>
      </header>

      {banner ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="grid min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm lg:col-span-2">
          <p className="border-b border-slate-50 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Cola ({reviews.length})
          </p>
          {loading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando…
            </p>
          ) : reviews.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No hay correos pendientes. En{' '}
              <Link to="/correo" className="font-semibold text-accent underline">
                Correo
              </Link>{' '}
              use «Analizar bandeja» (varios a la vez) o «Analizar con IA» en un mensaje.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-50 overflow-y-auto">
              {reviews.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`flex w-full items-start gap-2 px-4 py-3 text-left transition hover:bg-violet-50/60 ${
                      selectedId === r.id ? 'bg-violet-50' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{r.subject || '(Sin asunto)'}</p>
                      <p className="truncate text-xs text-slate-500">{r.from_address || '—'}</p>
                      {r.classification?.vinculo_expediente &&
                      r.classification.vinculo_expediente !== 'no_aplica' ? (
                        <span
                          className={`mt-0.5 inline-block text-[9px] font-bold uppercase tracking-wider ${
                            r.classification.vinculo_expediente === 'encontrado'
                              ? 'text-emerald-700'
                              : r.classification.vinculo_expediente === 'no_encontrado'
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {etiquetaVinculo(r.classification.vinculo_expediente)}
                        </span>
                      ) : null}
                      <p className="mt-1 text-[10px] text-slate-400">{formatReviewDate(r.received_at || r.created_at)}</p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm lg:col-span-3">
          {!selected ? (
            <p className="p-8 text-center text-sm text-slate-500">Seleccione un correo de la cola.</p>
          ) : (
            <div className="flex h-full flex-col">
              <div className="space-y-4 border-b border-slate-50 p-5">
                <h2 className="text-lg font-bold text-slate-900">{selected.subject}</h2>
                <p className="text-xs text-slate-500">
                  De: {selected.from_address || '—'} · {formatReviewDate(selected.received_at)}
                </p>

                {cls ? (
                  <div className={`rounded-xl border px-3 py-2.5 text-sm ${vinculoBoxClass}`}>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                      {etiquetaVinculo(vinculo)}
                    </p>
                    <p className="mt-1">{mensajeVinculo(cls)}</p>
                    {cls.referencia_proceso || cls.radicado_referencia ? (
                      <p className="mt-2 font-mono text-xs opacity-90">
                        Ref. proceso: {cls.referencia_proceso || cls.radicado_referencia}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {cls ? (
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-violet-800">
                      {TIPO_LABELS[cls.tipo] || cls.tipo}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                        CONFIANZA_STYLES[cls.confianza] || CONFIANZA_STYLES.baja
                      }`}
                    >
                      Confianza {cls.confianza}
                    </span>
                  </div>
                ) : null}

                {cls?.descripcion_breve ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{cls.descripcion_breve}</p>
                ) : null}

                {(cls?.accionante || cls?.accionado || cls?.radicado_referencia) && (
                  <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    {cls.radicado_referencia ? (
                      <div>
                        <dt className="font-bold text-slate-500">Radicado ref.</dt>
                        <dd className="font-mono text-slate-800">{cls.radicado_referencia}</dd>
                      </div>
                    ) : null}
                    {cls.accionante ? (
                      <div>
                        <dt className="font-bold text-slate-500">Accionante</dt>
                        <dd className="text-slate-800">{cls.accionante}</dd>
                      </div>
                    ) : null}
                    {cls.accionado ? (
                      <div>
                        <dt className="font-bold text-slate-500">Accionado</dt>
                        <dd className="text-slate-800">{cls.accionado}</dd>
                      </div>
                    ) : null}
                  </dl>
                )}

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Expediente destino
                  </p>
                  {vinculo === 'no_encontrado' ? (
                    <p className="mt-2 text-xs">
                      <Link to="/cases" className="font-semibold underline">
                        Buscar expedientes
                      </Link>{' '}
                      o cree la tutela en «Nueva tutela» antes de ingresar este correo.
                    </p>
                  ) : cls?.casos_candidatos?.length ? (
                    <select
                      value={selectedCaseId}
                      onChange={(e) => setSelectedCaseId(e.target.value)}
                      disabled={vinculo === 'encontrado' && Boolean(cls.expediente_vinculado_id)}
                      className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100"
                    >
                      <option value="">— Seleccione expediente —</option>
                      {cls.casos_candidatos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {formatRadicado(c.radicado)} — {c.claimant} vs {c.defendant} ({c.etapa_actual})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-2 text-xs text-amber-800">
                      Sin candidatos en base de datos.{' '}
                      <Link to="/cases" className="font-semibold underline">
                        Buscar expediente
                      </Link>
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Propuesta de ingreso ({selected.proposed_ingest.length} piezas)
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Pulse una pieza para verla antes de aprobar el ingreso.
                  </p>
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/80 p-2">
                    {selected.proposed_ingest.map((p, i) => (
                      <li key={`${p.kind}-${i}`}>
                        <button
                          type="button"
                          onClick={() => setPreviewPieceIndex(i)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                            previewPieceIndex === i
                              ? 'bg-violet-100 text-violet-950 ring-1 ring-violet-200'
                              : 'bg-white text-slate-700 hover:bg-violet-50/80'
                          }`}
                        >
                          {previewPieceIndex === i ? (
                            <Eye className="h-3.5 w-3.5 shrink-0 text-violet-700" aria-hidden />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
                          )}
                          <span className="truncate">{p.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selected.proposed_ingest[previewPieceIndex] ? (
                    <div className="mt-3">
                      <CorreoIngestPiecePreview
                        review={selected}
                        piece={selected.proposed_ingest[previewPieceIndex]}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-50 p-5">
                <button
                  type="button"
                  disabled={busy || !aprobarOk}
                  onClick={() => void handleApprove()}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Aprobar ingreso
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReject()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  Descartar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
