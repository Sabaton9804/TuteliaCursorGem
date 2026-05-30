import React, { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Case } from '../../types';
import { formatRadicado } from '../../lib/formatters';
import { searchPrecedentsForCase, type PrecedentSearchHit } from '../../lib/ai-despacho-api';
import { PrecedentSourceBadge } from './PrecedentSourceBadge';
import { DESPACHO_AI_DISCLAIMER } from '../../lib/ai-despacho-assist';

type Props = {
  caseItem: Case;
};

export function DespachoPrecedentsAssist({ caseItem }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PrecedentSearchHit[]>([]);

  const queryText = [caseItem.legalDerechoTutelado, caseItem.legalHechos, caseItem.legalPretensiones]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  useEffect(() => {
    const courtId = caseItem.courtId?.trim();
    if (!courtId || !queryText) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const res = await searchPrecedentsForCase({ courtId, queryText });
        if (!cancelled) setRows(res.slice(0, 6));
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseItem.id, caseItem.courtId, queryText]);

  return (
    <section className="rounded-2xl border border-violet-100 bg-violet-50/30 p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-violet-700" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-violet-800">
            Precedentes al redactar
          </h3>
        </div>
        <Link
          to="/biblioteca-precedentes"
          className="text-[10px] font-bold uppercase tracking-wide text-violet-700 hover:underline"
        >
          Biblioteca completa
        </Link>
      </div>
      <p className="text-[11px] text-slate-600 leading-relaxed">
        Consulta orientativa en biblioteca del despacho (fallos indexados y jurisprudencia cargada). No redacta sentencias ni
        sustituye la decisión del juez. No es búsqueda en internet.
      </p>
      {!queryText ? (
        <p className="text-xs text-slate-500">Complete derecho tutelado e hechos en el expediente para ver sugerencias.</p>
      ) : loading ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
          Buscando precedentes…
        </p>
      ) : err ? (
        <p className="text-xs text-amber-800">{err}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">Sin coincidencias en biblioteca. Indexe sentencias en Biblioteca de precedentes.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-violet-100 bg-white p-3 text-[11px] shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                <PrecedentSourceBadge
                  sourceType={p.source_type}
                  sourceCorporation={p.source_corporation}
                  compact
                />
                <span className="font-semibold tabular-nums text-violet-700">
                  {Math.round(Number(p.similarity) * 1000) / 10}%
                </span>
              </div>
              <p className="font-mono font-bold text-slate-800">{formatRadicado(p.radicado)}</p>
              <p className="mt-1 line-clamp-2 text-slate-700">{p.right_protected}</p>
              {p.matched_snippet?.trim() ? (
                <p className="mt-1 line-clamp-3 rounded bg-violet-50/80 px-2 py-1 text-[10px] text-slate-600">
                  {p.matched_snippet.trim()}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (p.source_case_id) navigate(`/case/${p.source_case_id}`);
                }}
                className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-violet-700 hover:text-violet-900"
              >
                Ver en expediente / PDF
                <ExternalLink className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[9px] text-slate-500 border-t border-violet-100/80 pt-2">{DESPACHO_AI_DISCLAIMER}</p>
    </section>
  );
}
