import React, { useMemo } from 'react';
import type { JSONContent } from '@tiptap/core';
import type { PreviewSketchV1 } from '../../lib/review-markup-payload';
import { summarizeReviewMarkupDiff } from '../../lib/review-markup-diff';

type Props = {
  baselineDoc?: JSONContent;
  currentDoc: JSONContent;
  previewSketch?: PreviewSketchV1;
};

export function ReviewMarkupDiffSummary({ baselineDoc, currentDoc, previewSketch }: Props) {
  const summary = useMemo(
    () => summarizeReviewMarkupDiff(baselineDoc, currentDoc, previewSketch),
    [baselineDoc, currentDoc, previewSketch],
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2.5 text-xs text-slate-800">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Resumen de cambios (Jurion)</p>
      {!summary.hasBaseline ? (
        <p className="mt-1.5 leading-snug text-slate-600">
          No hay línea base guardada para comparar (revisión anterior a esta función o sin guardado intermedio).
          Comentarios anclados en el documento: <strong>{summary.commentCount}</strong>.
          {summary.sketchStrokeCount > 0 ? (
            <>
              {' '}
              Trazos sobre la vista previa: <strong>{summary.sketchStrokeCount}</strong>.
            </>
          ) : null}
        </p>
      ) : (
        <>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 leading-snug text-slate-700">
            <li>
              Bloques de texto distintos respecto al borrador inicial:{' '}
              <strong>{summary.blocksChanged}</strong> (de {summary.blocksTotal} detectados en el editor).
            </li>
            <li>
              Comentarios del juez (anclados): <strong>{summary.commentCount}</strong>.
            </li>
            {summary.sketchStrokeCount > 0 ? (
              <li>
                Trazos libres sobre la vista previa Word: <strong>{summary.sketchStrokeCount}</strong>.
              </li>
            ) : null}
          </ul>
          {summary.wordDiffLines.length > 0 ? (
            <div className="mt-2 border-t border-slate-200 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Diff por palabras (muestra)
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 font-mono text-[10px] leading-snug text-slate-700">
                {summary.wordDiffLines.map((line, i) => (
                  <li key={i} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {summary.changedSnippets.length > 0 ? (
            <div className="mt-2 border-t border-slate-200 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Fragmentos tocados (bloque)
              </p>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-[11px] text-slate-600">
                {summary.changedSnippets.map((s, i) => (
                  <li key={i} className="break-words">
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ) : summary.blocksChanged === 0 ? (
            <p className="mt-1.5 text-slate-600">Sin diferencias de texto entre la línea base y esta versión.</p>
          ) : null}
        </>
      )}
      <p className="mt-2 border-t border-slate-200 pt-2 text-[10px] leading-snug text-slate-500">
        El .docx del expediente no se modifica automáticamente: use esta lista y el Word descargado para aplicar
        correcciones con trazabilidad en su entorno habitual.
      </p>
    </div>
  );
}
