import React from 'react';

export type PrecedentSourceType = 'despacho' | 'jurisprudencia' | string;

type Props = {
  sourceType?: PrecedentSourceType | null;
  sourceCorporation?: string | null;
  /** Compacto para tarjetas pequeñas en síntesis */
  compact?: boolean;
};

/**
 * Badge azul: fallo propio del despacho. Badges verdes: jurisprudencia + corporación.
 */
export function PrecedentSourceBadge({ sourceType, sourceCorporation, compact }: Props) {
  const st = sourceType === 'jurisprudencia' ? 'jurisprudencia' : 'despacho';
  if (st === 'jurisprudencia') {
    const corp = (sourceCorporation || '').trim() || 'Corporación';
    return (
      <span className={`inline-flex flex-wrap items-center gap-1 ${compact ? '' : 'mt-1'}`}>
        <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-900">
          Jurisprudencia
        </span>
        <span className="inline-flex max-w-full rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[9px] font-semibold text-emerald-900">
          {corp}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-900 ${compact ? '' : 'mt-1'}`}
    >
      Este despacho
    </span>
  );
}
