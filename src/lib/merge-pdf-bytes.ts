import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { ensurePdfJsWorker } from './pdfjs-worker';

ensurePdfJsWorker();

/**
 * Añade páginas de un PDF a un documento destino.
 * Primero intenta copia estructural (pdf-lib). Si falla (cifrado de permisos,
 * xref rotos, etc. — comunes en PDFs del RAMA que PDF.js sí abre), rasteriza
 * con PDF.js y embebe JPEG.
 */
export async function appendPdfBytesToDocument(
  merged: PDFDocument,
  pdfBytes: Uint8Array
): Promise<void> {
  // pdf-lib no descifra: con /Encrypt la copia estructural suele fallar o salir en blanco.
  if (pdfLooksEncrypted(pdfBytes)) {
    await appendRasterizedPages(merged, pdfBytes);
    return;
  }
  try {
    const donor = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const copied = await merged.copyPages(donor, donor.getPageIndices());
    for (const page of copied) merged.addPage(page);
  } catch {
    await appendRasterizedPages(merged, pdfBytes);
  }
}

/** Heurística: muchos PDF del RAMA traen /Encrypt (permisos) aunque se abran sin clave. */
function pdfLooksEncrypted(bytes: Uint8Array): boolean {
  const sampleLen = Math.min(bytes.length, 256_000);
  const head = bytes.subarray(0, Math.min(bytes.length, 80_000));
  const tail = bytes.subarray(Math.max(0, bytes.length - sampleLen));
  const asLatin1 = (u8: Uint8Array) => {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
    return s;
  };
  return /\/Encrypt[\s/<]/.test(asLatin1(head)) || /\/Encrypt[\s/<]/.test(asLatin1(tail));
}

async function appendRasterizedPages(merged: PDFDocument, pdfBytes: Uint8Array): Promise<void> {
  const data = pdfBytes.slice();
  const src = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  try {
    for (let i = 1; i <= src.numPages; i++) {
      const page = await src.getPage(i);
      const viewport = page.getViewport({ scale: 1.75 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('No se pudo crear el lienzo para procesar el PDF.');
      }
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const jpegBytes = await canvasToJpegBytes(canvas, 0.85);
      const image = await merged.embedJpg(jpegBytes);
      const outPage = merged.addPage([image.width, image.height]);
      outPage.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });

      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await src.destroy();
  }
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Fallo al convertir una página del PDF a imagen.'));
          return;
        }
        void blob.arrayBuffer().then(
          (buf) => resolve(new Uint8Array(buf)),
          reject
        );
      },
      'image/jpeg',
      quality
    );
  });
}
