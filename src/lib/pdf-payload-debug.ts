import * as pdfjs from 'pdfjs-dist';
import { looksLikePdf } from './pdf-sniff';

const TAG = '[tutelia:pdf-debug]';

function workerSnapshot() {
  const raw = pdfjs.GlobalWorkerOptions.workerSrc;
  const src = typeof raw === 'string' ? raw : '';
  return {
    workerSrcPreview: src.slice(0, 200),
    workerIsReactPdfBrokenDefault: src === 'pdf.worker.mjs',
    workerLooksBundled:
      src.includes('/assets/') || src.startsWith('blob:') || src.startsWith('data:'),
  };
}

export type PdfDebugWhere = 'NewCase.PdfViewer' | 'CaseDetail.PdfViewer';
export type PdfDebugPhase = 'open' | 'load-ok' | 'load-fail' | 'source-fail' | 'timeout';

/**
 * Logs estructurados solo en desarrollo (Vite `import.meta.env.DEV`).
 * Abre DevTools → Consola al seleccionar un adjunto PDF (p. ej. EscritoDemanda).
 */
export function logPdfViewerDebug(opts: {
  where: PdfDebugWhere;
  phase: PdfDebugPhase;
  filename: string;
  contentType?: string;
  bytes?: Uint8Array | null;
  signedUrlPrefix?: string;
  msSinceOpen?: number;
  message?: string;
}): void {
  if (!import.meta.env.DEV) return;

  const payload: Record<string, unknown> = {
    where: opts.where,
    phase: opts.phase,
    file: opts.filename,
    contentType: opts.contentType,
    ...workerSnapshot(),
  };

  if (opts.signedUrlPrefix) {
    payload.signedUrlPrefix = opts.signedUrlPrefix;
  }
  if (opts.msSinceOpen != null && Number.isFinite(opts.msSinceOpen)) {
    payload.msSinceOpen = Math.round(opts.msSinceOpen);
  }
  if (opts.message) {
    payload.message = opts.message;
  }

  const b = opts.bytes;
  if (b && b.byteLength > 0) {
    const n = Math.min(32, b.byteLength);
    const hex = Array.from(b.subarray(0, n))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join(' ');
    let utf8Probe = '';
    try {
      utf8Probe = new TextDecoder('utf8', { fatal: false })
        .decode(b.subarray(0, Math.min(256, b.byteLength)))
        .replace(/\s+/g, ' ')
        .slice(0, 140);
    } catch {
      utf8Probe = '(no se pudo decodificar como UTF-8)';
    }
    payload.byteLength = b.byteLength;
    payload.headHex32 = hex;
    payload.utf8Probe = utf8Probe;
    payload.looksPdfMagic = looksLikePdf(b);
    payload.zipMagicPK =
      b.byteLength >= 2 && b[0] === 0x50 && b[1] === 0x4b ? true : false;
  }

  const bad = opts.phase === 'load-fail' || opts.phase === 'source-fail' || opts.phase === 'timeout';
  if (bad) {
    console.warn(TAG, payload);
  } else {
    console.info(TAG, payload);
  }
}
