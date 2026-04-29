import React from 'react';

const MARKER_RE = /(\{\{[^}]+\}\})/g;

/**
 * Vista previa de solo lectura: resalta segmentos `{{VARIABLE}}`.
 */
export function MarcadoresPreview({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(MARKER_RE);
  return (
    <div
      className={`max-h-56 overflow-auto rounded-lg border border-violet-100 bg-violet-50/40 p-3 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap break-words ${className}`}
      aria-readonly
    >
      {parts.length === 0 ? <span className="text-slate-400">(vacío)</span> : null}
      {parts.map((part, i) => {
        const isMarker = /^\{\{[^}]+\}\}$/.test(part);
        if (isMarker) {
          return (
            <mark
              key={i}
              className="mx-0.5 rounded border border-violet-300 bg-violet-200/90 px-1 py-0.5 font-semibold text-violet-950"
            >
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}
