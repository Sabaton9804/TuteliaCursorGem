import type { Document } from '../types';
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
