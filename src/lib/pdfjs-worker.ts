/**
 * react-pdf/dist/index.js hace `pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs'` al cargarse.
 * Ese path no existe en el navegador → «Failed to resolve module specifier 'pdf.worker.mjs'».
 *
 * Además, si este módulo se evalúa ANTES que react-pdf (p. ej. vía merge-pdf-bytes), el side-effect
 * inicial no basta: hay que volver a llamar {@link ensurePdfJsWorker} DESPUÉS de importar react-pdf.
 */
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export function ensurePdfJsWorker(): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

ensurePdfJsWorker();

if (import.meta.env.DEV) {
  console.info('[tutelia:pdf-debug] worker fijado:', String(workerSrc).slice(0, 160));
}
