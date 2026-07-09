import type { Document } from '../types';
import type { CaseType } from '../types';
import { sortDocumentsByActTimeline } from './case-act-types';
import { DEFAULT_NOTEBOOK_CODE, normalizeNotebookCode } from './expediente-notebook';

function maxSortOrderInNotebook(docs: Document[], notebookCode: string): number {
  const code = normalizeNotebookCode(notebookCode);
  return docs
    .filter((d) => normalizeNotebookCode(d.notebookCode) === code)
    .reduce((m, d) => Math.max(m, d.order ?? 0), -1);
}

/** Siguiente `sort_order` en el cuaderno principal (misma regla que carga manual en expediente digital). */
export function nextSortOrderInPrincipalNotebook(docs: Document[]): number {
  return maxSortOrderInNotebook(docs, DEFAULT_NOTEBOOK_CODE) + 1;
}

/** Sufijo numérico del nombre protocolo SGDE (p. ej. Correo01 → 1, AutoinadmiteDemanda06 → 6). */
export function sgdeProtocolSuffixOrder(name: string | undefined | null): number | null {
  if (!name?.trim()) return null;
  const base = name.replace(/\.pdf$/i, '').trim();
  const m = base.match(/(\d{1,4})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function isSgdeExpedientePiece(doc: Document): boolean {
  return Boolean(
    doc.sgdeId?.trim() ||
      doc.type === 'sgde_migrate' ||
      doc.sgdeSyncStatus === 'linked' ||
      doc.sgdeSyncStatus === 'sgde_only',
  );
}

/** Clave de orden para piezas vinculadas a SGDE (índice del expediente, no orden alfabético). */
export function sgdeExpedienteSortKey(doc: Document): number {
  const suffix =
    sgdeProtocolSuffixOrder(doc.name) ?? sgdeProtocolSuffixOrder(doc.originalName) ?? null;
  if (suffix != null) return suffix;
  return 1_000_000 + (doc.order ?? 0);
}

/** Compara dos piezas del cuaderno por índice SGDE o sort_order. */
export function compareExpedientePiezas(a: Document, b: Document): number {
  const sgdeA = isSgdeExpedientePiece(a);
  const sgdeB = isSgdeExpedientePiece(b);
  if (sgdeA && sgdeB) {
    const ka = sgdeExpedienteSortKey(a);
    const kb = sgdeExpedienteSortKey(b);
    if (ka !== kb) return ka - kb;
    return (a.order ?? 0) - (b.order ?? 0);
  }
  return (a.order ?? 0) - (b.order ?? 0);
}

/** Orden de listado en cuaderno: SGDE por índice del expediente; tutela local por timeline de actos. */
export function sortExpedienteCuadernoPiezas(
  docs: Document[],
  caseType: CaseType | null | undefined,
): Document[] {
  if (docs.length > 0 && docs.every(isSgdeExpedientePiece)) {
    return [...docs].sort((a, b) => compareExpedientePiezas(a, b));
  }
  if (caseType === 'tutela_primera') {
    return sortDocumentsByActTimeline(docs, caseType);
  }
  return [...docs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
