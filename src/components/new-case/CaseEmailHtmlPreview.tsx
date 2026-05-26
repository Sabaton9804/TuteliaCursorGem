import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';

const EMAIL_ZOOM_SCALES = [0.5, 0.75, 1, 1.25, 1.5] as const;
type EmailZoom = 'fit' | (typeof EMAIL_ZOOM_SCALES)[number];

function buildEmailSrcDoc(html: string, fitWidthPx: number): string {
  const maxW = fitWidthPx > 0 ? `${Math.max(280, fitWidthPx - 40)}px` : '100%';
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.5;
        color: #334155;
        padding: 20px;
        box-sizing: border-box;
        max-width: ${maxW};
        margin-left: auto;
        margin-right: auto;
        overflow-wrap: anywhere;
      }
      img { max-width: 100% !important; height: auto !important; }
      table { max-width: 100% !important; }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}

export type CaseEmailHtmlPreviewProps = {
  html?: string | false | null;
  text?: string | false | null;
};

export function CaseEmailHtmlPreview({ html, text }: CaseEmailHtmlPreviewProps) {
  const [zoom, setZoom] = useState<EmailZoom>('fit');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitWidthPx, setFitWidthPx] = useState(640);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setFitWidthPx(Math.max(240, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const htmlStr = typeof html === 'string' && html.trim() ? html : '';
  const textStr = typeof text === 'string' ? text : '';

  const srcDoc = useMemo(
    () => (htmlStr ? buildEmailSrcDoc(htmlStr, fitWidthPx) : ''),
    [htmlStr, fitWidthPx]
  );

  const scale = zoom === 'fit' ? 1 : zoom;
  const textFontSize = zoom === 'fit' ? undefined : `${Math.round(14 * zoom)}px`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={viewportRef}
        className="flex min-h-0 flex-1 justify-center overflow-auto bg-slate-100 p-4"
      >
        {htmlStr ? (
          <div
            className="min-h-[min(100%,28rem)] w-full max-w-full origin-top bg-white shadow-lg"
            style={
              zoom === 'fit'
                ? { maxWidth: '100%' }
                : {
                    transform: `scale(${scale})`,
                    transformOrigin: 'top center',
                    width: `${100 / scale}%`,
                  }
            }
          >
            <iframe
              key={`${zoom}-${fitWidthPx}`}
              srcDoc={srcDoc}
              title="Cuerpo del correo"
              className="block w-full border-none"
              style={{ minHeight: 'min(70vh, 720px)', height: '70vh' }}
            />
          </div>
        ) : (
          <div
            className="w-full max-w-full rounded-lg border border-slate-200 bg-white p-10 font-sans text-sm leading-relaxed text-slate-600 whitespace-pre-wrap shadow-lg"
            style={{ fontSize: textFontSize }}
          >
            {textStr || 'Sin contenido de correo.'}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Vista HTML del correo · desplácese para ver todo
          </span>
          <div className="hidden h-4 w-px bg-slate-200 sm:block" />
          <select
            value={zoom === 'fit' ? 'fit' : String(zoom)}
            onChange={(e) => {
              const v = e.target.value;
              setZoom(v === 'fit' ? 'fit' : (Number(v) as EmailZoom));
            }}
            className="max-w-[11rem] cursor-pointer border-none bg-transparent text-[10px] font-bold uppercase text-slate-500 focus:ring-0"
            title="Ajustar ancho encaja el contenido en el panel"
          >
            <option value="fit">Ajustar ancho</option>
            {EMAIL_ZOOM_SCALES.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </div>
        <span className="flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-accent">
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          Correo de notificación (no es el PDF del expediente)
        </span>
      </div>
    </div>
  );
}
