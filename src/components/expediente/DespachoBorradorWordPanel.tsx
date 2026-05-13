import React, { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentTemplatePageLayout } from '../../types';
import type { PlantillasMembrete } from '../../lib/plantillas-store';
import { mergePageLayout } from '../../lib/document-template-page-layout';
import { MembreteRichPreview } from '../plantillas/MembreteRichSurface';

type Props = {
  membrete: PlantillasMembrete;
  draft: string;
  onDraftChange: (next: string) => void;
  /** Plantilla Word subida: el .docx no se arma desde este texto; el borrador queda solo referencia. */
  readOnlyDraft: boolean;
  readOnlyExplanation: string;
  pageLayout: DocumentTemplatePageLayout | null | undefined;
  /** Si existe, sustituye al bloque «Cuerpo del documento» + textarea. */
  draftBodySlot?: ReactNode;
};

function mmToCssPx(mm: number): string {
  return `${(mm * 96) / 25.4}px`;
}

/** Altura mínima del cuerpo en px (≈10 renglones); el área crece con el texto para evitar scroll interno. */
const CUERPO_TEXTAREA_MIN_PX = 168;

export function DespachoBorradorWordPanel({
  membrete,
  draft,
  onDraftChange,
  readOnlyDraft,
  readOnlyExplanation,
  pageLayout,
  draftBodySlot,
}: Props) {
  const cuerpoRef = useRef<HTMLTextAreaElement>(null);

  const L = useMemo(() => mergePageLayout(pageLayout), [pageLayout]);

  const pad = useMemo(
    () => ({
      paddingTop: mmToCssPx(L.marginMm.top),
      paddingRight: mmToCssPx(L.marginMm.right),
      paddingBottom: mmToCssPx(L.marginMm.bottom),
      paddingLeft: mmToCssPx(L.marginMm.left),
    }),
    [L.marginMm.bottom, L.marginMm.left, L.marginMm.right, L.marginMm.top],
  );

  /** Márgenes tipo Word para el cuerpo TipTap (2,5 cm). */
  const padRichCuerpo = useMemo(
    () => ({
      paddingTop: mmToCssPx(25),
      paddingRight: mmToCssPx(25),
      paddingBottom: mmToCssPx(25),
      paddingLeft: mmToCssPx(25),
    }),
    [],
  );

  const fontStyle = useMemo(() => {
    const name = L.fontFamily.trim();
    const quoted = name.includes(' ') ? `"${name.replace(/"/g, '')}"` : name;
    return {
      fontFamily: `${quoted}, "Times New Roman", Times, serif`,
      fontSize: `${(L.fontSizePt * 96) / 72}px`,
      lineHeight: 1.38 as const,
    };
  }, [L.fontFamily, L.fontSizePt]);

  /** Con TipTap: una sola «hoja» a ancho completo (sin isla centrada ~A4). */
  const hojaClassName = draftBodySlot
    ? 'despacho-borrador-hoja w-full max-w-none bg-white font-serif shadow-[0_2px_16px_rgba(15,23,42,0.07)] ring-1 ring-slate-300/75'
    : 'despacho-borrador-hoja mx-auto max-w-[min(100%,210mm)] bg-white font-serif shadow-md ring-1 ring-slate-300/80';

  const syncCuerpoTextareaHeight = useCallback(() => {
    const el = cuerpoRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, CUERPO_TEXTAREA_MIN_PX)}px`;
  }, []);

  useLayoutEffect(() => {
    if (draftBodySlot) return;
    syncCuerpoTextareaHeight();
  }, [draft, draftBodySlot, readOnlyDraft, L.fontSizePt, L.fontFamily, syncCuerpoTextareaHeight]);

  useEffect(() => {
    if (draftBodySlot) return;
    const onResize = () => syncCuerpoTextareaHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draftBodySlot, draft, syncCuerpoTextareaHeight]);

  return (
    <div
      className={
        draftBodySlot
          ? 'rounded-xl border border-slate-200/95 bg-slate-200/55 p-3 sm:p-5'
          : 'rounded-xl border border-slate-200 bg-slate-200/50 p-3 sm:p-5'
      }
    >
      {draftBodySlot ? null : (
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Borrador (estilo documento)</p>
      )}
      <div className={hojaClassName} style={draftBodySlot ? padRichCuerpo : pad}>
        <MembreteRichPreview membrete={membrete} embedded />
        {draftBodySlot ? (
          <div className="mt-0 min-w-0 pt-1 text-slate-900">{draftBodySlot}</div>
        ) : (
          <>
            <p className="mb-1.5 mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Cuerpo del documento</p>
            <textarea
              ref={cuerpoRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              readOnly={readOnlyDraft}
              spellCheck={false}
              rows={1}
              className="despacho-borrador-cuerpo box-border min-h-[10.5rem] w-full resize-none overflow-hidden border-0 bg-transparent text-slate-900 [text-align:justify] outline-none ring-0 focus:ring-0 disabled:cursor-default disabled:opacity-90"
              style={fontStyle}
              aria-label="Cuerpo del borrador"
            />
          </>
        )}
      </div>
      {readOnlyDraft ? (
        <p className="mt-2 text-xs leading-snug text-slate-600">{readOnlyExplanation}</p>
      ) : draftBodySlot ? null : (
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Edite aquí el texto; al pulsar <strong className="text-slate-700">Generar documento</strong> se usará este borrador
          (modo generado por el sistema). Si cambia plantilla, casillas o datos del caso sin tocar el texto, el borrador se
          actualiza solo si no lo ha modificado usted.
        </p>
      )}
    </div>
  );
}
