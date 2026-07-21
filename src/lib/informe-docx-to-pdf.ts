import mammoth from 'mammoth';
import type { DocumentTemplatePageLayout } from '../types';
import { mergePageLayout } from './document-template-page-layout';

function coercePdfBlob(out: unknown): Blob {
  if (out instanceof Blob) return out;
  if (out instanceof ArrayBuffer) return new Blob([out], { type: 'application/pdf' });
  if (out instanceof Uint8Array) return new Blob([out], { type: 'application/pdf' });
  throw new Error(`Salida PDF inesperada (${typeof out}). Revise la consola del navegador.`);
}

/**
 * Mammoth lee `w:jc` en `alignment` pero no lo vuelca a HTML (diseño semántico).
 * Reasignamos styleName + styleMap → clases CSS con text-align (center / justify / right).
 */
function mammothTransformPreserveParagraphAlignment(element: {
  type?: string;
  alignment?: string | null;
  styleName?: string | null;
  [key: string]: unknown;
}) {
  if (element.type !== 'paragraph') return element;
  const align = String(element.alignment || '')
    .trim()
    .toLowerCase();
  if (!align || align === 'left' || align === 'start') return element;
  if (align === 'center') return { ...element, styleName: 'TuteliaAlignCenter' };
  if (align === 'right' || align === 'end') return { ...element, styleName: 'TuteliaAlignRight' };
  if (align === 'both' || align === 'justify') return { ...element, styleName: 'TuteliaAlignJustify' };
  return element;
}

const MAMMOTH_ALIGN_STYLE_MAP = [
  "p[style-name='TuteliaAlignCenter'] => p.tutelia-align-center:fresh",
  "p[style-name='TuteliaAlignRight'] => p.tutelia-align-right:fresh",
  "p[style-name='TuteliaAlignJustify'] => p.tutelia-align-justify:fresh",
];

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

async function waitForFonts(): Promise<void> {
  try {
    const fonts = document.fonts;
    if (fonts?.ready) await fonts.ready;
  } catch {
    /* ignore */
  }
}

/** Quita overlays de generación PDF que, si quedan, bloquean clics en expediente digital. */
export function cleanupTuteliaPdfGenerationOverlays(): void {
  document.querySelectorAll('[data-tutelia-pdf-host]').forEach((el) => el.remove());
  document.querySelectorAll('.html2canvas-container').forEach((el) => el.remove());
  if (document.body.style.userSelect === 'none') document.body.style.userSelect = '';
  if (document.body.style.cursor === 'col-resize' || document.body.style.cursor === 'wait') {
    document.body.style.cursor = '';
  }
}

function createPdfHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.setAttribute('data-tutelia-pdf-host', '1');
  /**
   * html2canvas suele devolver lienzo vacío si el nodo está muy fuera del viewport.
   * Se monta encima del documento; se quita al terminar.
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
  return host;
}

function pdfCaptureCss(marginMm: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): string {
  const pad = `${marginMm.top}mm ${marginMm.right}mm ${marginMm.bottom}mm ${marginMm.left}mm`;
  return `
    .tutelia-pdf-from-docx {
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #0f172a;
      background: #fff;
      width: 210mm;
      box-sizing: border-box;
    }
    .tutelia-pdf-from-docx .tutelia-docxjs-wrapper {
      background: transparent !important;
      padding: 0 !important;
      margin: 0 !important;
      display: block !important;
      width: 210mm !important;
      box-sizing: border-box !important;
    }
    .tutelia-pdf-from-docx .tutelia-docxjs-wrapper > section.tutelia-docxjs {
      margin: 0 !important;
      width: 210mm !important;
      max-width: 210mm !important;
      min-height: auto !important;
      background: #fff !important;
      box-shadow: none !important;
      padding: ${pad} !important;
      box-sizing: border-box !important;
    }
    .tutelia-pdf-from-docx .tutelia-docxjs p:not([style*="text-align: center"]):not([style*="text-align:center"]):not([style*="text-align: right"]):not([style*="text-align:right"]) {
      text-align: justify !important;
    }
    .tutelia-pdf-from-docx img {
      max-width: 100%;
      height: auto;
    }
    .tutelia-mammoth-pdf {
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 11pt;
      line-height: 1.38;
      color: #0f172a;
      text-align: justify;
      width: 210mm;
      box-sizing: border-box;
      padding: ${pad};
      background: #fff;
    }
    .tutelia-mammoth-pdf p {
      margin: 0 0 0.55em 0;
      text-align: inherit;
    }
    .tutelia-mammoth-pdf p.tutelia-align-center,
    .tutelia-mammoth-pdf h1.tutelia-align-center,
    .tutelia-mammoth-pdf h2.tutelia-align-center,
    .tutelia-mammoth-pdf h3.tutelia-align-center {
      text-align: center;
    }
    .tutelia-mammoth-pdf p.tutelia-align-right { text-align: right; }
    .tutelia-mammoth-pdf p.tutelia-align-justify { text-align: justify; }
    .tutelia-mammoth-pdf h1, .tutelia-mammoth-pdf h2, .tutelia-mammoth-pdf h3 {
      margin: 0.4em 0 0.35em;
      font-weight: 700;
      text-align: center;
    }
    .tutelia-mammoth-pdf img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0.35em auto;
    }
  `;
}

async function html2pdfFromElement(el: HTMLElement, filename: string): Promise<Blob> {
  const mod = await import('html2pdf.js');
  const html2pdf = (mod as { default?: typeof import('html2pdf.js').default }).default;
  if (typeof html2pdf !== 'function') {
    throw new Error('No se pudo cargar html2pdf.js');
  }

  const tallDoc = el.scrollHeight > 3200;
  const canvasScale = tallDoc ? 1.5 : 2;

  const rawOut = await html2pdf()
    .set({
      /** Márgenes ya van en el padding de la “hoja” (docx-preview / mammoth). */
      margin: 0,
      filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: canvasScale,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        windowWidth: Math.max(el.scrollWidth, Math.round((210 * 96) / 25.4)),
        windowHeight: el.scrollHeight,
        /** Evita que hojas globales (Tailwind oklch) rompan el parseo del clon. */
        onclone: (clonedDoc: Document) => {
          const keep = clonedDoc.querySelector('[data-tutelia-pdf-host]');
          clonedDoc.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
            if (keep && keep.contains(node)) return;
            node.remove();
          });
        },
      },
      // @ts-expect-error — opción válida para html2pdf.js
      pagebreak: { mode: ['css', 'legacy'] },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    })
    .from(el)
    .outputPdf('blob');

  return coercePdfBlob(rawOut);
}

async function buildPdfViaDocxPreview(
  docxBlob: Blob,
  marginMm: { top: number; right: number; bottom: number; left: number },
): Promise<Blob> {
  const host = createPdfHost();
  const style = document.createElement('style');
  style.textContent = pdfCaptureCss(marginMm);

  const styleBox = document.createElement('div');
  styleBox.setAttribute('data-tutelia-docx-styles', '1');

  const body = document.createElement('div');
  body.className = 'tutelia-pdf-from-docx tutelia-docx-preview-host';
  body.style.pointerEvents = 'none';
  body.style.opacity = '1';
  body.style.background = '#fff';

  host.appendChild(style);
  host.appendChild(styleBox);
  host.appendChild(body);
  document.body.appendChild(host);

  try {
    const { renderAsync } = await import('docx-preview');
    await renderAsync(docxBlob, body, styleBox, {
      inWrapper: true,
      breakPages: true,
      ignoreWidth: false,
      ignoreHeight: false,
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

    await waitForImages(body);
    await waitForFonts();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await new Promise((r) => setTimeout(r, 120));

    const sections = body.querySelectorAll<HTMLElement>('section.tutelia-docxjs');
    const captureRoot =
      sections.length === 1
        ? sections[0]!
        : (body.querySelector<HTMLElement>('.tutelia-docxjs-wrapper') ?? body);

    if (!captureRoot.innerText?.trim() && captureRoot.querySelectorAll('img').length === 0) {
      throw new Error('docx-preview no generó contenido visible.');
    }

    return await html2pdfFromElement(captureRoot, 'informe-ingreso.pdf');
  } finally {
    host.remove();
  }
}

async function buildPdfViaMammoth(
  docxBlob: Blob,
  marginMm: { top: number; right: number; bottom: number; left: number },
  fontStack: string,
  fontSizePt: number,
): Promise<Blob> {
  const arrayBuffer = await docxBlob.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      transformDocument: mammoth.transforms.paragraph(mammothTransformPreserveParagraphAlignment),
      styleMap: MAMMOTH_ALIGN_STYLE_MAP,
    },
  );

  const host = createPdfHost();
  const style = document.createElement('style');
  style.textContent = pdfCaptureCss(marginMm);

  const inner = document.createElement('div');
  inner.className = 'tutelia-mammoth-pdf';
  inner.style.fontFamily = fontStack;
  inner.style.fontSize = `${fontSizePt}pt`;
  inner.style.pointerEvents = 'none';
  inner.style.opacity = '1';

  const bodyWrap = document.createElement('div');
  bodyWrap.innerHTML = html;

  host.appendChild(style);
  inner.appendChild(bodyWrap);
  host.appendChild(inner);
  document.body.appendChild(host);

  try {
    await waitForImages(inner);
    await waitForFonts();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await new Promise((r) => setTimeout(r, 80));
    return await html2pdfFromElement(inner, 'informe-ingreso.pdf');
  } finally {
    host.remove();
  }
}

/**
 * Convierte el mismo .docx que se descarga en Word a PDF (membrete, alineaciones, imágenes).
 * Preferimos docx-preview (misma fidelidad que la vista previa del expediente) + html2pdf.
 * Mammoth queda como respaldo si docx-preview falla.
 */
export async function buildPdfBlobFromJudicialDocx(
  docxBlob: Blob,
  pageLayout?: DocumentTemplatePageLayout | null,
): Promise<Blob> {
  cleanupTuteliaPdfGenerationOverlays();

  const L = mergePageLayout(pageLayout);
  const fontStack = `${String(L.fontFamily).replace(/;/g, '')}, "Times New Roman", Times, Georgia, serif`;
  const fontSizePt = Math.max(9, Math.min(18, L.fontSizePt));
  const marginMm = {
    top: Math.max(8, L.marginMm.top),
    right: Math.max(8, L.marginMm.right),
    bottom: Math.max(10, L.marginMm.bottom),
    left: Math.max(8, L.marginMm.left),
  };

  try {
    try {
      return await buildPdfViaDocxPreview(docxBlob, marginMm);
    } catch (e) {
      console.warn('[informe] PDF vía docx-preview falló; se intenta Mammoth+alineación:', e);
      return await buildPdfViaMammoth(docxBlob, marginMm, fontStack, fontSizePt);
    }
  } finally {
    cleanupTuteliaPdfGenerationOverlays();
  }
}
