import React, { useState } from 'react';
import { CheckCircle2, ClipboardCopy, Loader2, SpellCheck, X } from 'lucide-react';
import { aiReviewJudicialText } from '../../lib/ai-despacho-api';
import { DESPACHO_AI_DISCLAIMER } from '../../lib/ai-despacho-assist';

type Props = {
  documentLabel: string;
  getText: () => string;
  onApplyCorrectedText?: (text: string) => void;
  disabled?: boolean;
};

export function JudicialDocAiToolbar({
  documentLabel,
  getText,
  onApplyCorrectedText,
  disabled,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [corrected, setCorrected] = useState('');
  const [issues, setIssues] = useState<
    Array<{ kind: string; excerpt: string; suggestion: string; note: string }>
  >([]);

  const runReview = async () => {
    const text = getText().trim();
    if (!text) {
      setErr('No hay texto en el borrador para revisar.');
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await aiReviewJudicialText({ text, documentLabel });
      setSummary(res.summary);
      setCorrected(res.correctedText);
      setIssues(res.issues);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void runReview()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-sky-900 hover:bg-sky-100 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SpellCheck className="h-3.5 w-3.5" />}
          Revisar redacción y ortografía (IA)
        </button>
        <span className="text-[10px] text-slate-500">Corrector del navegador activo en el editor</span>
      </div>

      {err ? (
        <p className="text-xs text-red-700 rounded-lg border border-red-100 bg-red-50 px-3 py-2">{err}</p>
      ) : null}

      {open ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />
              Revisión sugerida
            </p>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">{summary}</p>
          {issues.length > 0 ? (
            <ul className="max-h-40 overflow-y-auto space-y-1.5 text-[11px]">
              {issues.map((it, i) => (
                <li key={i} className="rounded-md border border-white/80 bg-white px-2 py-1.5">
                  <span className="font-bold uppercase text-[9px] text-sky-800">{it.kind}</span>
                  {it.excerpt ? <span className="text-slate-600"> · «{it.excerpt}»</span> : null}
                  {it.suggestion ? (
                    <span className="block text-slate-800 mt-0.5">→ {it.suggestion}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {onApplyCorrectedText ? (
              <button
                type="button"
                onClick={() => {
                  onApplyCorrectedText(corrected);
                  setOpen(false);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-sky-700 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-sky-800"
              >
                Aplicar texto corregido al borrador
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(corrected)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Copiar corregido
            </button>
          </div>
          <p className="text-[9px] text-slate-500 leading-snug">{DESPACHO_AI_DISCLAIMER}</p>
        </div>
      ) : null}
    </div>
  );
}
