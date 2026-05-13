import React, { useEffect, useRef, useState, type CSSProperties } from 'react';
import mammoth from 'mammoth';
import { Download, Info, Loader2, Minus, Plus, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CASE_DOCUMENTS_BUCKET } from '../../lib/case-document-storage';
import { downloadCaseDocxFromStoragePath } from '../../lib/download-case-docx';
import type { PreviewSketchV1 } from '../../lib/review-markup-payload';
import { PreviewFreehandSketch } from './PreviewFreehandSketch';

type Props = {
  storagePath?: string;
  filename: string;
  onBack?: () => void;
  /** Menos altura y aviso acortado (p. ej. incrustado en «Documentos por revisar»). */
  compact?: boolean;
  /** Anotaciones a mano alzada sobre la vista previa (no alteran el .docx). */
  freehand?: {
    value?: PreviewSketchV1;
    onChange?: (next: PreviewSketchV1) => void;
    readOnly?: boolean;
  };
  /** En modo compacto (p. ej. «Documentos por revisar»): aviso de que el texto editable está en otra sección. */
  compactEditHintPlacement?: 'above' | 'below';
};

/**
 * Vista previa del .docx en el navegador (`docx-preview`, mejor fidelidad que mammoth) + descarga.
 * La revisión formal (comentarios, formato exacto) sigue siendo en Microsoft Word con el archivo descargado.
 */
const ZOOM_STEPS = [75, 90, 100, 115, 130, 150, 175, 200] as const;

export function ExpedienteDocxPreview({
  storagePath,
  filename,
  onBack,
  compact,
  freehand,
  compactEditHintPlacement,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  /** Nodo sticky donde se portaliza la barra «Anotar» (re-render al montar el div). */
  const [freehandToolbarMount, setFreehandToolbarMount] = useState<HTMLDivElement | null>(null);
  const [compactHelpOpen, setCompactHelpOpen] = useState(false);
  const compactHelpRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<'docx-preview' | 'mammoth' | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);

  useEffect(() => {
    setZoomPct(100);
  }, [storagePath]);

  useEffect(() => {
    if (!compactHelpOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (compactHelpRef.current && !compactHelpRef.current.contains(e.target as Node)) {
        setCompactHelpOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [compactHelpOpen]);

  useEffect(() => {
    const host = hostRef.current;
    let cancelled = false;

    void (async () => {
      setPhase('loading');
      setErr(null);
      setEngine(null);
      const path = storagePath?.trim();
      if (!path) {
        setErr('Este documento no tiene ruta en almacenamiento (.docx esperado en bucket).');
        setPhase('error');
        return;
      }
      if (host) host.innerHTML = '';

      const { data: blob, error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
      if (cancelled) return;
      if (error || !blob) {
        setErr(error?.message || 'No se pudo obtener el archivo desde el almacenamiento.');
        setPhase('error');
        return;
      }

      let buf: ArrayBuffer;
      try {
        buf = await blob.arrayBuffer();
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'No se pudo leer el documento.');
          setPhase('error');
        }
        return;
      }

      if (cancelled || !host) return;

      try {
        const { renderAsync } = await import('docx-preview');
        await renderAsync(new Blob([buf]), host, undefined, {
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreFonts: false,
          className: 'tutelia-docxjs',
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderChanges: false,
          renderComments: false,
          useBase64URL: true,
        });
        if (!cancelled) {
          setEngine('docx-preview');
          setPhase('ready');
        }
      } catch {
        try {
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (cancelled || !host) return;
          host.innerHTML = value?.trim()
            ? value
            : '<p class="text-slate-500">(Contenido vacío o no convertible)</p>';
          setEngine('mammoth');
          setPhase('ready');
        } catch (e2) {
          if (!cancelled) {
            setErr(e2 instanceof Error ? e2.message : 'No se pudo mostrar el documento.');
            setPhase('error');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [storagePath]);

  const path = storagePath?.trim();

  const bumpZoom = (dir: -1 | 1) => {
    setZoomPct((z) => {
      const nearest = ZOOM_STEPS.reduce((best, s) =>
        Math.abs(s - z) < Math.abs(best - z) ? s : best,
      ZOOM_STEPS[0]);
      const idx = ZOOM_STEPS.indexOf(nearest);
      return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir))] ?? 100;
    });
  };

  const onDownloadClick = async () => {
    if (!path) return;
    setDownloadBusy(true);
    setErr(null);
    try {
      await downloadCaseDocxFromStoragePath(path, filename);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo descargar el .docx.');
    } finally {
      setDownloadBusy(false);
    }
  };

  const zoomStyle: CSSProperties = { zoom: `${zoomPct}%` };

  const showFreehand =
    freehand &&
    phase === 'ready' &&
    (typeof freehand.onChange === 'function' || (freehand.value?.strokes?.length ?? 0) > 0);
  /** Evita un frame con la barra en esquina antes del portal (ref del sticky aún null). */
  const freehandSketchReady =
    !showFreehand || typeof freehand.onChange !== 'function' || freehandToolbarMount != null;

  const compactOuter =
    compact &&
    (compactEditHintPlacement
      ? 'min-h-[320px] max-h-[min(58vh,720px)]'
      : 'min-h-[380px] max-h-[min(92vh,980px)]');

  return (
    <div
      className={`flex flex-col rounded-2xl border border-slate-200 bg-white ${compact ? compactOuter : 'min-h-[520px]'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Vista previa Word</p>
          {compact ? (
            <div className="relative" ref={compactHelpRef}>
              <button
                type="button"
                aria-expanded={compactHelpOpen}
                aria-label="Nota sobre la vista previa y descarga Word"
                onClick={() => setCompactHelpOpen((o) => !o)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Info className="h-4 w-4" aria-hidden />
              </button>
              {compactHelpOpen ? (
                <div
                  className="absolute left-0 top-full z-40 mt-1 w-80 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-amber-200 bg-amber-50/95 p-3 text-[10px] leading-snug text-amber-950 shadow-lg"
                  role="region"
                  aria-label="Ayuda vista previa"
                >
                  <p>
                    Vista previa en el navegador (mejor con <strong className="font-semibold">docx-preview</strong>; no es
                    idéntica a Word). Para <strong className="font-semibold">formato judicial exacto</strong>, comentarios y
                    control de cambios, use <strong className="font-semibold">Descargar .docx</strong> y abra el archivo en
                    Microsoft Word.
                  </p>
                  {freehand?.onChange ? (
                    <p className="mt-2">
                      Use <strong className="font-semibold">Anotar</strong> para trazos sobre esta vista; se guardan en
                      Tutelia y no modifican el .docx del expediente.
                    </p>
                  ) : null}
                  {engine === 'mammoth' ? (
                    <p className="mt-2 text-amber-900/90">
                      (Conversión alternativa: parte del diseño puede verse distinta.)
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              title="Reducir zoom"
              aria-label="Reducir zoom"
              onClick={() => bumpZoom(-1)}
              disabled={zoomPct <= ZOOM_STEPS[0]}
              className="rounded-md p-1.5 text-slate-600 hover:bg-white disabled:opacity-30"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span className="min-w-[3rem] px-1 text-center text-[10px] font-bold tabular-nums text-slate-700">
              {zoomPct}%
            </span>
            <button
              type="button"
              title="Aumentar zoom"
              aria-label="Aumentar zoom"
              onClick={() => bumpZoom(1)}
              disabled={zoomPct >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              className="rounded-md p-1.5 text-slate-600 hover:bg-white disabled:opacity-30"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              title="Restablecer zoom"
              aria-label="Restablecer zoom al 100%"
              onClick={() => setZoomPct(100)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          {path ? (
            <button
              type="button"
              onClick={() => void onDownloadClick()}
              disabled={downloadBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {downloadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" aria-hidden />}
              Descargar .docx
            </button>
          ) : null}
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-accent"
            >
              Cerrar
            </button>
          ) : null}
        </div>
      </div>
      {!compact ? (
        <p className="border-b border-amber-100 bg-amber-50/90 px-4 py-2 text-[10px] leading-snug text-amber-950">
          La vista previa se acerca al Word pero no lo sustituye. Para revisión y firma descargue el .docx y ábralo en
          Word.
          {engine === 'mammoth' ? (
            <span className="mt-1 block text-amber-900/90">
              (Se usó conversión alternativa: parte del diseño puede verse distinta.)
            </span>
          ) : null}
        </p>
      ) : null}
      {compact && compactEditHintPlacement ? (
        <p
          className={`border-b border-indigo-100 bg-indigo-50/90 px-4 py-2 text-[10px] leading-snug text-indigo-950`}
        >
          {compactEditHintPlacement === 'above' ? (
            <>
              El <strong className="font-semibold">texto editable</strong> y los comentarios están en la sección{' '}
              <strong className="font-semibold">«Edición en Tutelia»</strong> arriba. Esta vista es solo referencia
              visual (HTML); las anotaciones a mano alzada aquí no cambian el .docx del expediente.
            </>
          ) : (
            <>
              El <strong className="font-semibold">texto editable</strong> está en <strong className="font-semibold">«Edición en Tutelia»</strong>{' '}
              debajo. Esta zona es solo referencia visual.
            </>
          )}
        </p>
      ) : null}
      <div
        className={`relative min-h-0 flex-1 overflow-auto ${compact ? 'bg-slate-200/60 p-3' : 'bg-slate-200/50 p-4'}`}
        data-preview-engine={engine ?? undefined}
      >
        {showFreehand && freehand?.onChange ? (
          <div className="sticky top-0 z-20 flex justify-center py-1.5">
            <div
              ref={setFreehandToolbarMount}
              className="inline-flex min-h-[2.5rem] min-w-0 flex-wrap items-center justify-center gap-1"
              aria-label="Herramientas de anotación sobre la vista previa"
            />
          </div>
        ) : null}
        {phase === 'loading' ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-slate-200/85 py-16 text-slate-500 backdrop-blur-[1px]">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm font-medium">Preparando vista previa…</span>
          </div>
        ) : null}
        {phase === 'error' && err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</div>
        ) : null}
        <div
          className={`relative mx-auto w-full max-w-[210mm] text-slate-900 ${
            phase === 'error'
              ? 'hidden'
              : phase === 'ready'
                ? compact
                  ? 'min-h-[min(72vh,297mm)]'
                  : ''
                : 'invisible pointer-events-none min-h-[14rem]'
          }`}
          style={phase === 'ready' ? zoomStyle : undefined}
        >
          <div
            ref={hostRef}
            className={`tutelia-docx-preview-host min-h-[12rem] w-full ${phase === 'error' ? 'hidden' : ''}`}
            aria-hidden={phase !== 'ready'}
          />
          {showFreehand && freehandSketchReady ? (
            <PreviewFreehandSketch
              value={freehand!.value}
              onChange={freehand!.onChange ?? (() => {})}
              readOnly={Boolean(freehand!.readOnly || !freehand!.onChange)}
              toolbarPortalEl={freehand?.onChange ? freehandToolbarMount : undefined}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
