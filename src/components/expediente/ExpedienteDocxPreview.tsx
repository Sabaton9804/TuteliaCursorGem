import React, { useEffect, useState } from 'react';
import mammoth from 'mammoth';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CASE_DOCUMENTS_BUCKET, CASE_DOCUMENT_SIGNED_URL_TTL_SEC } from '../../lib/case-document-storage';

type Props = {
  storagePath?: string;
  filename: string;
  onBack?: () => void;
};

/**
 * Vista aproximada del .docx (mammoth → HTML) + descarga. No sustituye Word para edición formal.
 */
export function ExpedienteDocxPreview({ storagePath, filename, onBack }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      setHtml(null);
      setDownloadUrl(null);
      const path = storagePath?.trim();
      if (!path) {
        setErr('Este documento no tiene ruta en almacenamiento (.docx esperado en bucket).');
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.storage
        .from(CASE_DOCUMENTS_BUCKET)
        .createSignedUrl(path, CASE_DOCUMENT_SIGNED_URL_TTL_SEC);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        setErr(error?.message || 'No se pudo firmar la URL de descarga.');
        setLoading(false);
        return;
      }
      setDownloadUrl(data.signedUrl);
      try {
        const res = await fetch(data.signedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setHtml(value?.trim() ? value : '<p class="text-slate-500">(Contenido vacío o no convertible)</p>');
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'No se pudo convertir el Word a vista previa.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return (
    <div className="flex min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Vista previa Word</p>
        <div className="flex flex-wrap items-center gap-2">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={filename}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Descargar .docx
            </a>
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
        La conversión a HTML puede alterar formato respecto al Word original. Para revisión y firma use el archivo
        descargado; los apuntes del despacho van en la pestaña «Documentos por revisar».
      </p>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm font-medium">Convirtiendo documento…</span>
          </div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</div>
        ) : html ? (
          <div
            className="prose prose-sm max-w-none text-slate-800 [&_table]:text-xs [&_td]:border [&_td]:border-slate-200 [&_th]:border [&_th]:border-slate-300"
            // mammoth: salida HTML acotada desde documento propio del despacho
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
      </div>
    </div>
  );
}
