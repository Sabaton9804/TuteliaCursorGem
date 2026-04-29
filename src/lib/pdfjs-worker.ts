/**
 * react-pdf/dist/index.js hace `pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs'` al cargarse.
 * Ese path no existe en el navegador → el visor se queda en «Renderizando PDF…».
 * Este módulo debe ejecutarse DESPUÉS de cualquier `import … from 'react-pdf'` (p. ej. al final de main.tsx).
 */
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

if (import.meta.env.DEV) {
  console.info('[tutelia:pdf-debug] worker fijado tras react-pdf:', String(workerSrc).slice(0, 160));
}
