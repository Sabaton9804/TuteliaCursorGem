import React, { useEffect, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { BookOpen, ExternalLink, Loader2, Scale, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Link, useNavigate } from 'react-router-dom';
import { useCaseDetail } from '../../contexts/CaseDetailContext';
import { formatRadicado } from '../../lib/formatters';
import { isTutelaFalloPlazoCaseType, plazoFallarAjusteManualHint, plazoFallarLabelForCase } from '../../lib/decreto-2591-plazos';
import { plazoFallarSnapshotForCase } from '../../lib/plazo-fallar-tutela';
import { isCivilCaseType, partyRoleLabels } from '../../lib/process-product-scope';
import { CASE_STATUS_LABEL } from './case-detail-status-labels';
import { PrecedentSourceBadge } from './PrecedentSourceBadge';
import { apiAuthHeaders } from '../../lib/supabase-write-auth';

export type CaseSintesisPanelProps = {
  isSummarizing: boolean;
  onSummarize: () => void | Promise<void>;
  deadlineDraft: string;
  setDeadlineDraft: (v: string) => void;
  deadlineNoteDraft: string;
  setDeadlineNoteDraft: (v: string) => void;
  deadlineSaving: boolean;
  onSaveDeadline: () => void | Promise<void>;
};

type PrecedentMatch = {
  id: string;
  source_type?: string | null;
  source_corporation?: string | null;
  source_case_id?: string | null;
  radicado: string;
  right_protected: string;
  defendant: string;
  ruling_sense: string;
  summary: string;
  legal_arguments: string;
  source_excerpt?: string | null;
  decision_date?: string | null;
  tags?: unknown;
  similarity: number;
  matched_snippet?: string | null;
  matched_chunk_index?: number | null;
};

const PRECEDENTES_ACUERDO_FOOTNOTE =
  'Sugerencia informativa. Decisión exclusiva del juez. Uso registrado conforme al Acuerdo PCSJA24-12243';

type SintesisPartyRow = {
  nombre: string;
  identificacion?: string;
  email?: string;
};

/** Parte campos unidos con `;` (como al guardar desde el análisis IA) en filas nombre + CC. */
function parseJoinedPartyRows(
  names: string | undefined,
  ids: string | undefined,
  emails: string | undefined,
): SintesisPartyRow[] {
  const split = (s?: string) =>
    (s || '')
      .split(/\s*;\s*|\n+/)
      .map((x) => x.trim())
      .filter(Boolean);

  const ns = split(names);
  const is = split(ids);
  const es = split(emails);
  const n = Math.max(ns.length, is.length, es.length);
  if (n === 0) {
    const fallback = (names || '').trim();
    return fallback ? [{ nombre: fallback }] : [];
  }

  const rows: SintesisPartyRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const nombre = ns[i] || (n === 1 ? (names || '').trim() : `Parte ${i + 1}`);
    if (!nombre && !is[i] && !es[i]) continue;
    rows.push({
      nombre: nombre || '—',
      ...(is[i] ? { identificacion: is[i] } : {}),
      ...(es[i] ? { email: es[i] } : {}),
    });
  }
  return rows;
}

function PartySideList({
  title,
  names,
  ids,
  emails,
}: {
  title: string;
  names?: string;
  ids?: string;
  emails?: string;
}) {
  const rows = parseJoinedPartyRows(names, ids, emails);
  return (
    <div className="min-w-0 px-6 py-6 sm:px-8 sm:py-7 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Sin datos</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((p, i) => (
            <li key={`${p.nombre}-${p.identificacion || i}`} className="min-w-0 space-y-1">
              <p className="text-[15px] font-bold text-slate-800 leading-snug tracking-tight">{p.nombre}</p>
              <div className="flex flex-wrap gap-2">
                {p.identificacion ? (
                  <span className="inline-flex rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    {/^\d[\d.\-]*\d$|^\d+$/.test(p.identificacion)
                      ? `CC ${p.identificacion}`
                      : p.identificacion}
                  </span>
                ) : (
                  <span className="inline-flex rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-1 text-[10px] font-medium text-slate-400">
                    Identificación no disponible
                  </span>
                )}
              </div>
              {p.email ? (
                <p className="text-xs font-medium text-sky-700/90 truncate" title={p.email}>
                  {p.email}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function rulingSenseVariant(sense: string): 'concede' | 'niega' | 'neutral' {
  const t = sense.trim().toLowerCase();
  if (t.includes('conced')) return 'concede';
  if (t.includes('niega') || /^neg/.test(t)) return 'niega';
  return 'neutral';
}

export function CaseSintesisPanel({
  isSummarizing,
  onSummarize,
  deadlineDraft,
  setDeadlineDraft,
  deadlineNoteDraft,
  setDeadlineNoteDraft,
  deadlineSaving,
  onSaveDeadline,
}: CaseSintesisPanelProps) {
  const { caseItem, docs, setActiveTab } = useCaseDetail();
  const navigate = useNavigate();
  const [precedents, setPrecedents] = useState<PrecedentMatch[]>([]);
  const [precLoading, setPrecLoading] = useState(false);
  const [precErr, setPrecErr] = useState<string | null>(null);
  const [detailPrec, setDetailPrec] = useState<PrecedentMatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    const courtId = caseItem.courtId?.trim();
    const derecho = (caseItem.legalDerechoTutelado || '').trim();
    const hechos = (caseItem.legalHechos || '').trim();
    const queryText = [derecho, hechos].filter(Boolean).join('\n\n').trim();

    if (!courtId || !queryText) {
      setPrecedents([]);
      setPrecLoading(false);
      setPrecErr(null);
      return;
    }

    setPrecLoading(true);
    setPrecErr(null);
    void (async () => {
      try {
        const res = await fetch('/api/precedents/search', {
          method: 'POST',
          headers: await apiAuthHeaders({ json: true }),
          body: JSON.stringify({ courtId, queryText }),
        });
        const j = (await res.json().catch(() => ({}))) as { results?: PrecedentMatch[]; error?: string };
        if (!res.ok) {
          throw new Error(typeof j.error === 'string' ? j.error : 'No se pudo consultar precedentes');
        }
        if (!cancelled) setPrecedents(Array.isArray(j.results) ? j.results : []);
      } catch (e) {
        if (!cancelled) {
          setPrecedents([]);
          setPrecErr(e instanceof Error ? e.message : 'Error de red');
        }
      } finally {
        if (!cancelled) setPrecLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [caseItem.id, caseItem.courtId, caseItem.legalDerechoTutelado, caseItem.legalHechos]);

  const queryTextForPrec = [caseItem.legalDerechoTutelado, caseItem.legalHechos].filter(Boolean).join('\n\n').trim();
  const showTutelaFalloPlazo = isTutelaFalloPlazoCaseType(caseItem.caseType);
  const plazoFallarLabel = plazoFallarLabelForCase(caseItem.caseType);
  const plazoFallarAjusteHint = plazoFallarAjusteManualHint(caseItem.caseType);
  const plazoFallarSnap = plazoFallarSnapshotForCase(caseItem);
  const isCivil = isCivilCaseType(caseItem.caseType);
  const partyLabels = partyRoleLabels(caseItem.caseType);
  const claimantsTitle = partyLabels.claimantPlural;
  const defendantsTitle = partyLabels.defendantPlural;
  const claimantSingularLower = partyLabels.claimantSingular.toLowerCase();

  return (
    <div className="card-modern w-full min-w-0 overflow-hidden shadow-sm transition-all hover:shadow-lg">
      <div className="bg-white px-6 sm:px-8 py-3.5 border-b border-slate-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
          Síntesis cognitiva judicial
        </div>
        <div className="flex flex-col sm:items-end gap-1">
          <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400 normal-case">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            GPT-4o optimizado
          </div>
          <p className="hidden sm:block text-[9px] text-slate-500 font-medium normal-case tracking-normal text-right max-w-[240px] leading-snug">
            Documentos y constancia de ingreso en la pestaña Expediente digital. La IA usa plazos y piezas del expediente
            al generar la síntesis.
          </p>
        </div>
      </div>

      <div className="bg-white">
        <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
          <PartySideList
            title={claimantsTitle}
            names={caseItem.claimant}
            ids={caseItem.claimantId}
            emails={caseItem.claimantEmail}
          />
          <PartySideList
            title={defendantsTitle}
            names={caseItem.defendant}
            ids={caseItem.defendantId}
            emails={caseItem.defendantEmail}
          />
        </div>

        {caseItem.legalHechos || caseItem.legalPretensiones || caseItem.legalDerechoTutelado ? (
          <>
            <div className="grid grid-cols-1 divide-y divide-slate-100 border-b border-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 animate-in fade-in duration-500">
              <div className="min-w-0 px-6 py-6 sm:px-8 sm:py-7 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Hechos relevantes</p>
                <p className="text-sm leading-relaxed text-slate-700">
                  {caseItem.legalHechos || 'Sin datos de hechos específicos.'}
                </p>
              </div>
              <div className="min-w-0 px-6 py-6 sm:px-8 sm:py-7 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Pretensiones</p>
                <div className="rounded-xl border border-emerald-100/80 bg-emerald-50/90 px-4 py-3.5">
                  <p className="text-sm font-medium leading-relaxed text-emerald-900">
                    {caseItem.legalPretensiones || 'Sin pretensiones identificadas.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/40 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Derecho tutelado
              </span>
              <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-left text-xs font-semibold text-sky-900 sm:text-right">
                <Scale className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
                <span className="leading-snug">{caseItem.legalDerechoTutelado || 'No especificado'}</span>
              </div>
            </div>
          </>
        ) : null}

        <section
          className="border-b border-slate-100 bg-violet-50/20 px-6 py-5 sm:px-8"
          aria-labelledby="precedentes-despacho-heading"
        >
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between" id="precedentes-despacho-heading">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <BookOpen className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
              Precedentes y jurisprudencia
            </div>
            <Link
              to="/biblioteca-precedentes"
              className="text-[10px] font-bold uppercase tracking-wide text-violet-700 hover:text-violet-900 hover:underline"
            >
              Ver biblioteca completa
            </Link>
          </div>
          {!queryTextForPrec ? (
            <p className="text-[11px] text-slate-500">Indique derecho tutelado e hechos en el expediente para buscar precedentes.</p>
          ) : precLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-violet-600" aria-hidden />
              Buscando precedentes…
            </div>
          ) : precErr ? (
            <p className="text-[11px] text-amber-700/90">{precErr}</p>
          ) : precedents.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Sin resultados similares (fallos del despacho ni jurisprudencia de referencia)
            </p>
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-1 md:grid-cols-3">
                {precedents.map((p) => {
                  const sense = rulingSenseVariant(p.ruling_sense);
                  const pct = Math.round(Number(p.similarity) * 1000) / 10;
                  return (
                    <li
                      key={p.id}
                      className="flex min-w-0 flex-col rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <PrecedentSourceBadge
                          sourceType={p.source_type}
                          sourceCorporation={p.source_corporation}
                          compact
                        />
                        <span className="text-[10px] font-semibold tabular-nums text-violet-700">{pct}% similitud</span>
                      </div>
                      <span className="font-mono text-[11px] font-bold text-slate-800">
                        {formatRadicado(p.radicado)}
                      </span>
                      <span
                        className={`mb-1.5 mt-1.5 inline-flex w-fit rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                          sense === 'concede'
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                            : sense === 'niega'
                              ? 'border border-rose-200 bg-rose-50 text-rose-800'
                              : 'border border-slate-200 bg-slate-50 text-slate-600'
                        }`}
                      >
                        {sense === 'concede' ? 'Concedió' : sense === 'niega' ? 'Negó' : p.ruling_sense}
                      </span>
                      <p className="line-clamp-2 text-[11px] font-medium text-slate-800">{p.right_protected}</p>
                      {p.matched_snippet?.trim() ? (
                        <p className="mt-1.5 line-clamp-4 rounded-md border border-violet-100 bg-violet-50/50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-700">
                          {p.matched_snippet.trim()}
                        </p>
                      ) : null}
                      <p className="mt-1 line-clamp-2 text-[10px] text-slate-600">
                        {p.source_type === 'jurisprudencia'
                          ? `Corporación: ${p.source_corporation || '—'}`
                          : `${partyLabels.defendantSingular}: ${p.defendant}`}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (p.source_case_id) {
                            navigate(`/case/${p.source_case_id}`);
                          } else {
                            setDetailPrec(p);
                          }
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-700 hover:text-violet-900"
                      >
                        Ver fallo completo
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 border-t border-slate-200/80 pt-3 text-[9px] leading-snug text-slate-500">
                {PRECEDENTES_ACUERDO_FOOTNOTE}
              </p>
            </>
          )}
        </section>

        <div className="space-y-8 px-6 py-8 sm:px-8">
          {caseItem.summary ? (
            <div className="prose prose-slate prose-sm max-w-none prose-headings:text-slate-900 prose-strong:text-accent font-sans leading-relaxed text-slate-600">
              <ReactMarkdown>{caseItem.summary}</ReactMarkdown>
            </div>
          ) : !caseItem.legalHechos ? (
            <div className="py-20 border-2 border-dashed border-slate-100 rounded-3xl text-center space-y-6">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
                <Sparkles className="w-8 h-8 text-accent animate-pulse" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-700">Sin síntesis procesal</h3>
                <p className="text-sm text-slate-400 font-medium max-w-xs mx-auto mt-2">
                  Active el asistente de IA para extraer hechos relevantes y pretensiones jurídicas.
                </p>
              </div>
              <button type="button" onClick={() => void onSummarize()} className="btn-primary px-10 py-3 text-xs">
                IDENTIFICAR HECHOS Y PRETENSIÓN
              </button>
            </div>
          ) : (
            <div className="pt-4 flex flex-col items-center gap-3 max-w-xl mx-auto text-center">
              <button
                type="button"
                onClick={() => void onSummarize()}
                disabled={isSummarizing}
                title={`Llama a la IA con el ${claimantSingularLower} y el texto del expediente para producir un informe en markdown y guardarlo en el campo síntesis del caso.`}
                className="text-[10px] font-bold text-accent uppercase tracking-widest bg-blue-50 px-4 py-2.5 rounded-lg border border-blue-100 hover:bg-blue-100/80 flex items-center gap-2 disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" /> Generar síntesis operativa completa
              </button>
              <p className="text-[11px] text-slate-500 leading-relaxed px-2">
                Construye el texto de <span className="font-semibold text-slate-600">síntesis procesal</span> (markdown)
                a partir del {claimantSingularLower} y del cuerpo del correo o expediente; no reemplaza hechos ni
                pretensiones ya guardados.
              </p>
            </div>
          )}

          <div className="sm:hidden flex flex-wrap justify-center border-t border-slate-100 pt-6">
            <button
              type="button"
              onClick={() => setActiveTab('expediente')}
              className="text-[10px] font-bold text-accent uppercase tracking-widest hover:underline"
            >
              Ir a expediente digital ({docs.length} documentos)
            </button>
          </div>
        </div>

        <details className="group border-t border-slate-100 bg-slate-50/50 px-4 py-2 sm:px-6 sm:py-2.5">
          <summary className="cursor-pointer list-none py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 hover:text-slate-600 [&::-webkit-details-marker]:hidden before:mr-1.5 before:inline-block before:text-slate-300 before:transition-transform before:content-['▸'] group-open:before:rotate-90">
            Contexto procesal (vista despacho)
          </summary>
          <ul className="mt-2 space-y-1.5 border-t border-slate-100/90 pt-2 pb-1 text-[10px] leading-snug text-slate-600">
            <li>
              <span className="font-semibold text-slate-500">Estado judicial: </span>
              {CASE_STATUS_LABEL[caseItem.status] ?? caseItem.status}
            </li>
            <li>
              <span className="font-semibold text-slate-500">Estado operativo: </span>
              {caseItem.operationalStatus?.trim() || 'Sin dato en expediente'}
            </li>
            {showTutelaFalloPlazo && plazoFallarLabel ? (
              <li>
                <span className="font-semibold text-slate-500">{plazoFallarLabel}: </span>
                {plazoFallarSnap?.pendingAnchor
                  ? 'Pendiente de recepción del expediente en despacho (informe de ingreso)'
                  : caseItem.deadlineAt && isValid(parseISO(caseItem.deadlineAt))
                    ? format(parseISO(caseItem.deadlineAt), "EEEE d 'de' MMMM yyyy", { locale: es })
                    : 'No registrado — use el desplegable siguiente o el backfill de plazos'}
                {caseItem.deadlineOverrideNote?.trim() ? (
                  <span className="mt-0.5 block font-normal text-slate-500">
                    Nota al plazo: {caseItem.deadlineOverrideNote.trim()}
                  </span>
                ) : null}
              </li>
            ) : null}
            <li>
              <span className="font-semibold text-slate-500">Piezas en expediente digital: </span>
              {docs.length === 0 ? 'Ninguna aún' : `${docs.length} (se envían títulos a la IA al analizar)`}
            </li>
          </ul>
        </details>

        {showTutelaFalloPlazo && plazoFallarAjusteHint ? (
        <details className="group border-t border-slate-100 bg-slate-50/50 px-4 py-2 sm:px-6 sm:py-2.5">
          <summary className="cursor-pointer list-none py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 hover:text-slate-600 [&::-webkit-details-marker]:hidden before:mr-1.5 before:inline-block before:text-slate-300 before:transition-transform before:content-['▸'] group-open:before:rotate-90">
            {plazoFallarAjusteHint}
          </summary>
          <div className="mt-2 space-y-2 border-t border-slate-100/90 pt-2 pb-1 text-[10px] text-slate-500">
            <p className="leading-snug">
              Suspensión, corrección, etc. Vacíe la fecha y guarde para quitar el plazo en base de datos.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-0 flex-col gap-0.5 font-medium text-slate-600">
                Fecha fin
                <input
                  type="date"
                  className="input-modern max-w-[200px] bg-white py-1 text-xs"
                  value={deadlineDraft}
                  onChange={(e) => setDeadlineDraft(e.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => void onSaveDeadline()}
                disabled={deadlineSaving}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {deadlineSaving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                Guardar
              </button>
            </div>
            <label className="flex flex-col gap-0.5 font-medium text-slate-600">
              Nota breve
              <textarea
                className="input-modern min-h-[48px] resize-y bg-white py-1 text-xs"
                rows={2}
                value={deadlineNoteDraft}
                onChange={(e) => setDeadlineNoteDraft(e.target.value)}
                placeholder="Ej. suspensión por acuerdo de partes…"
              />
            </label>
          </div>
        </details>
        ) : null}
      </div>

      {detailPrec ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prec-detail-title"
          onClick={() => setDetailPrec(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 id="prec-detail-title" className="text-sm font-bold text-slate-900">
                Precedente {formatRadicado(detailPrec.radicado)}
              </h2>
              <button
                type="button"
                onClick={() => setDetailPrec(null)}
                className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold uppercase text-slate-500 hover:bg-slate-100"
              >
                Cerrar
              </button>
            </div>
            <p className="text-[11px] font-semibold text-slate-700">{detailPrec.right_protected}</p>
            {detailPrec.matched_snippet?.trim() ? (
              <>
                <p className="mt-2 text-[10px] font-semibold uppercase text-violet-600">Fragmento más relevante</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-800 whitespace-pre-wrap">
                  {detailPrec.matched_snippet.trim()}
                </p>
              </>
            ) : null}
            <p className="mt-2 text-[11px] text-slate-600 whitespace-pre-wrap">{detailPrec.summary}</p>
            <p className="mt-3 text-[10px] font-semibold uppercase text-slate-400">Argumentos</p>
            <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{detailPrec.legal_arguments}</p>
            {detailPrec.source_excerpt ? (
              <>
                <p className="mt-3 text-[10px] font-semibold uppercase text-slate-400">Extracto</p>
                <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{detailPrec.source_excerpt}</p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
