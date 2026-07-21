import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Document } from '../../types';
import { fetchPieceAiAnalysis, loadCachedPieceAiAnalysis } from '../../lib/piece-ai-api';
import { isCaseDocumentPdf } from '../../lib/expediente-docx';
import {
  PIECE_AI_DISCLAIMER,
  pieceAiEligibility,
  type PieceAiAnalysisResponse,
} from '../../lib/piece-ai-analysis';

export type ExpedientePieceAiPanelProps = {
  caseId: string;
  doc: Document;
  pdfPageCount: number | null;
  /** Incrementar para forzar nueva lectura tras cambio de pieza manual. */
  refreshToken?: number;
  onAnalyzed?: () => void | Promise<void>;
};

export function ExpedientePieceAiPanel({
  caseId,
  doc,
  pdfPageCount,
  refreshToken = 0,
  onAnalyzed,
}: ExpedientePieceAiPanelProps) {
  const gate = pieceAiEligibility(doc, pdfPageCount);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PieceAiAnalysisResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (!gate.allowed) return;
      if (forceRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetchPieceAiAnalysis({
          caseId,
          caseDocumentId: doc.id,
          forceRefresh,
          pdfPageCount,
        });
        setResult(res);
        setExpanded(true);
        if (!res.cached) await onAnalyzed?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al analizar la pieza');
        if (forceRefresh) setResult(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [caseId, doc.id, gate.allowed, onAnalyzed, pdfPageCount]
  );

  useEffect(() => {
    setResult(null);
    setError(null);
    setExpanded(false);
    let cancelled = false;
    void (async () => {
      const cached = await loadCachedPieceAiAnalysis(doc.id, { fileHash: doc.fileHash });
      if (cancelled) return;
      if (cached) {
        setResult(cached);
        // Ya había lectura: mostrar el resumen al abrir la pieza (no solo el chip).
        setExpanded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.fileHash, refreshToken]);

  useEffect(() => {
    if (refreshToken <= 0 || !gate.allowed) return;
    if (isCaseDocumentPdf(doc) && pdfPageCount == null) return;
    void load(false);
  }, [refreshToken, gate.allowed, load, doc, pdfPageCount]);

  const busy = loading || refreshing;
  const canToggleCached = Boolean(result) && !busy;
  const primaryDisabled = busy || (!result && !gate.allowed);

  return (
    <div className="shrink-0 border-t border-slate-200 bg-slate-50/95">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <button
          type="button"
          disabled={primaryDisabled}
          title={
            result
              ? expanded
                ? 'Ocultar resumen de lectura IA'
                : 'Ver resumen de lectura IA guardado'
              : gate.reason
          }
          onClick={() => {
            if (result && !busy) {
              setExpanded((v) => !v);
              return;
            }
            void load(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-accent shadow-sm transition hover:bg-accent/5 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {result ? (expanded ? 'Ocultar lectura IA' : 'Ver lectura IA') : 'Lectura rápida con IA'}
        </button>
        {result ? (
          <button
            type="button"
            disabled={!gate.allowed || busy}
            title="Volver a analizar (nueva llamada a IA)"
            onClick={() => void load(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            Reanalizar
          </button>
        ) : null}
        {result?.cached ? (
          <button
            type="button"
            disabled={!canToggleCached}
            onClick={() => setExpanded((v) => !v)}
            className="text-[9px] font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:no-underline"
          >
            Resultado guardado{expanded ? '' : ' · ver'}
          </button>
        ) : null}
        {!gate.allowed && !result && gate.reason ? (
          <span className="text-[9px] leading-snug text-slate-500">{gate.reason}</span>
        ) : null}
      </div>

      {error ? (
        <p className="border-t border-amber-100 bg-amber-50/90 px-3 py-2 text-[10px] leading-snug text-amber-900 sm:px-4">
          {error}
        </p>
      ) : null}

      {expanded && result && !error ? (
        <div className="max-h-[min(28vh,16rem)] overflow-auto border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
          <div className="prose prose-sm max-w-none prose-headings:text-slate-800 prose-p:text-slate-700 prose-li:text-slate-700">
            <ReactMarkdown>{result.summaryMarkdown}</ReactMarkdown>
          </div>
          <p className="mt-3 border-t border-slate-100 pt-2 text-[9px] leading-snug text-slate-500">
            {PIECE_AI_DISCLAIMER}
          </p>
        </div>
      ) : loading && !result ? (
        <p className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500 sm:px-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Analizando pieza…
        </p>
      ) : null}
    </div>
  );
}
