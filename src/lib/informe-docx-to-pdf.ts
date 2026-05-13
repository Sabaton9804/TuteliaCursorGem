import mammoth from 'mammoth';
import type { DocumentTemplatePageLayout } from '../types';
import { mergePageLayout } from './document-template-page-layout';

function coercePdfBlob(out: unknown): Blob {
  if (out instanceof Blob) return out;
  if (out instanceof ArrayBuffer) return new Blob([out], { type: 'application/pdf' });
  if (out instanceof Uint8Array) return new Blob([out], { type: 'application/pdf' });
  throw new Error(`Salida PDF inesperada (${typeof out}). Revise la consola del navegador.`);
}

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
}

/**
 * Convierte el mismo .docx que se descarga en Word a PDF (membrete, alineaciones, imágenes).
 * Usa Mammoth (HTML) + html2pdf.js (canvas → PDF). Solo navegador.
 */
export async function buildPdfBlobFromJudicialDocx(
  docxBlob: Blob,
  pageLayout?: DocumentTemplatePageLayout | null,
): Promise<Blob> {
  const L = mergePageLayout(pageLayout);
  const fontStack = `${String(L.fontFamily).replace(/;/g, '')}, "Times New Roman", Times, Georgia, serif`;
  const fontSizePt = Math.max(9, Math.min(18, L.fontSizePt));

  const arrayBuffer = await docxBlob.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  const host = document.createElement('div');
  host.setAttribute('data-tutelia-pdf-host', '1');
  /**
   * html2canvas suele devolver lienzo vacío si el nodo está muy fuera del viewport (p. ej. left:-12000px).
   * Se monta encima del documento con opacidad casi nula para forzar pintado real; se quita al terminar.
   */
  host.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483000',
    'display:flex',
    'align-items:flex-start',
    'justify-content:center',
    'overflow:auto',
    'pointer-events:none',
    'background:transparent',
  ].join(';');

  const inner = document.createElement('div');
  inner.className = 'tutelia-mammoth-pdf';
  inner.style.fontFamily = fontStack;
  inner.style.fontSize = `${fontSizePt}pt`;
  inner.style.lineHeight = '1.38';
  inner.style.color = '#0f172a';
  inner.style.padding = '28px 32px 32px';
  inner.style.boxSizing = 'border-box';
  inner.style.width = '794px';
  inner.style.maxWidth = '100%';
  inner.style.background = '#fff';
  inner.style.boxShadow = '0 0 0 1px #e2e8f0';
  /** Debe ser opaco: html2canvas a menudo captura transparente si opacity ≈ 0. */
  inner.style.opacity = '1';
  /** Igual que el host: si no, el lienzo a pantalla completa roba clics mientras corre html2canvas (UI “congelada”). */
  inner.style.pointerEvents = 'none';

  const style = document.createElement('style');
  style.textContent = `
    .tutelia-mammoth-pdf p { margin: 0 0 0.55em 0; }
    .tutelia-mammoth-pdf h1, .tutelia-mammoth-pdf h2, .tutelia-mammoth-pdf h3 { margin: 0.4em 0 0.35em; font-weight: 700; }
    .tutelia-mammoth-pdf img { max-width: 100%; height: auto; display: block; margin: 0.35em auto; }
    .tutelia-mammoth-pdf ul, .tutelia-mammoth-pdf ol { margin: 0 0 0.55em 1.2em; padding: 0; }
    .tutelia-mammoth-pdf table { border-collapse: collapse; width: 100%; margin: 0.4em 0; }
    .tutelia-mammoth-pdf td, .tutelia-mammoth-pdf th { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
  `;

  inner.appendChild(style);
  const bodyWrap = document.createElement('div');
  bodyWrap.innerHTML = html;
  inner.appendChild(bodyWrap);
  host.appendChild(inner);
  document.body.appendChild(host);

  try {
    await waitForImages(inner);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await new Promise((r) => setTimeout(r, 80));

    const mod = await import('html2pdf.js');
    const html2pdf = (mod as { default?: typeof import('html2pdf.js').default }).default;
    if (typeof html2pdf !== 'function') {
      throw new Error('No se pudo cargar html2pdf.js');
    }

    const marginMm = [
      Math.max(8, L.marginMm.top),
      Math.max(8, L.marginMm.right),
      Math.max(10, L.marginMm.bottom),
      Math.max(8, L.marginMm.left),
    ] as [number, number, number, number];

    /** Documentos altos + scale 2 multiplican píxeles y bloquean el hilo principal varios segundos. */
    const tallDoc = inner.scrollHeight > 3200;
    const canvasScale = tallDoc ? 1 : 2;

    const rawOut = await html2pdf()
      .set({
        margin: marginMm,
        filename: 'informe-ingreso.pdf',
        image: { type: 'jpeg', quality: 0.94 },
        html2canvas: {
          scale: canvasScale,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          windowWidth: inner.scrollWidth,
          windowHeight: inner.scrollHeight,
        },
        // html2pdf.js admite pagebreak en runtime; los tipos publicados suelen omitirlo.
        // @ts-expect-error — opción válida para html2pdf.js
        pagebreak: { mode: ['css', 'legacy'] },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(inner)
      .outputPdf('blob');

    return coercePdfBlob(rawOut);
  } finally {
    host.remove();
  }
}
