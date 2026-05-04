import React, { useEffect, useRef, useState } from 'react';
import mammoth from 'mammoth';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CASE_DOCUMENTS_BUCKET } from '../../lib/case-document-storage';
import { downloadCaseDocxFromStoragePath } from '../../lib/download-case-docx';

type Props = {
  storagePath?: string;
  filename: string;
  onBack?: () => void;
  /** Menos altura y aviso acortado (p. ej. incrustado en «Documentos por revisar»). */
  compact?: boolean;
};

/**
 * Vista previa del .docx en el navegador (`docx-preview`, mejor fidelidad que mammoth) + descarga.
 * La revisión formal (comentarios, formato exacto) sigue siendo en Microsoft Word con el archivo descargado.
 */
export function ExpedienteDocxPreview({ storagePath, filename, onBack, compact }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<'docx-preview' | 'mammoth' | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

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

  return (
    <div
      className={`flex flex-col rounded-2xl border border-slate-200 bg-white ${compact ? 'min-h-[280px] max-h-[min(62vh,620px)]' : 'min-h-[520px]'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Vista previa Word</p>
        <div className="flex flex-wrap items-center gap-2">
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
      <p className="border-b border-amber-100 bg-amber-50/90 px-4 py-2 text-[10px] leading-snug text-amber-950">
        {compact ? (
          <>
            Vista previa en el navegador (mejor con <strong className="font-semibold">docx-preview</strong>; no es idéntica
            a Word). Para el <strong className="font-semibold">formato judicial exacto</strong>, comentarios y control de
            cambios, use <strong className="font-semibold">Descargar .docx</strong> y abra el archivo en Microsoft Word.
          </>
        ) : (
          <>
            La vista previa se acerca al Word pero no lo sustituye. Para revisión y firma descargue el .docx y ábralo en
            Word.
          </>
        )}
        {engine === 'mammoth' ? (
          <span className="mt-1 block text-amber-900/90">
            (Se usó conversión alternativa: parte del diseño puede verse distinta.)
          </span>
        ) : null}
      </p>
      <div
        className={`relative min-h-0 flex-1 overflow-auto ${compact ? 'bg-slate-200/60 p-3' : 'bg-slate-200/50 p-4'}`}
        data-preview-engine={engine ?? undefined}
      >
        {phase === 'loading' ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-slate-200/85 py-16 text-slate-500 backdrop-blur-[1px]">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm font-medium">Preparando vista previa…</span>
          </div>
        ) : null}
        {phase === 'error' && err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</div>
        ) : null}
        {/* Siempre montado: docx-preview necesita el nodo en el DOM durante la carga. */}
        <div
          ref={hostRef}
          className={`tutelia-docx-preview-host mx-auto min-h-[12rem] w-full max-w-[210mm] text-slate-900 ${
            phase === 'error'
              ? 'hidden'
              : phase === 'ready'
                ? ''
                : 'invisible pointer-events-none min-h-[14rem]'
          }`}
          aria-hidden={phase !== 'ready'}
        />
      </div>
    </div>
  );
}
