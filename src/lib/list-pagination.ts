/** Tamaño por defecto de filas visibles en tablas y listas. */
export const LIST_PAGE_SIZE_DEFAULT = 25;

export const LIST_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export type ListPageSizeOption = (typeof LIST_PAGE_SIZE_OPTIONS)[number];

export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  return Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
}

export function totalPages(totalItems: number, pageSize: number): number {
  if (totalItems <= 0) return 1;
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const p = clampPage(page, totalPages(items.length, pageSize));
  const start = (p - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** Rango inclusivo para `.range(from, to)` en PostgREST. */
export function supabaseRange(page: number, pageSize: number): { from: number; to: number } {
  const p = Math.max(1, Math.floor(page) || 1);
  const size = Math.max(1, Math.floor(pageSize) || LIST_PAGE_SIZE_DEFAULT);
  const from = (p - 1) * size;
  return { from, to: from + size - 1 };
}

export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return '0 de 0';
  const p = clampPage(page, totalPages(total, pageSize));
  const from = (p - 1) * pageSize + 1;
  const to = Math.min(p * pageSize, total);
  return `${from}–${to} de ${total}`;
}
