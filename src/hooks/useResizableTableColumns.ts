import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

export type ResizableColumnDef = {
  id: string;
  /** Ancho inicial en px */
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readStored(storageKey: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Anchos de columna arrastrables (estilo Excel), persistidos en localStorage.
 */
export function useResizableTableColumns(storageKey: string, columns: ResizableColumnDef[]) {
  const defaults = useRef(
    Object.fromEntries(columns.map((c) => [c.id, c.defaultWidth])) as Record<string, number>,
  );
  const metaById = useRef(
    Object.fromEntries(columns.map((c) => [c.id, c])) as Record<string, ResizableColumnDef>,
  );

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const stored = readStored(storageKey);
    const next = { ...defaults.current };
    if (stored) {
      for (const col of columns) {
        if (typeof stored[col.id] === 'number') {
          next[col.id] = clamp(
            stored[col.id]!,
            col.minWidth ?? 72,
            col.maxWidth ?? 640,
          );
        }
      }
    }
    return next;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      /* ignore quota */
    }
  }, [storageKey, widths]);

  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const beginResize = useCallback((columnId: string, clientX: number) => {
    const col = metaById.current[columnId];
    if (!col) return;
    const startW = widthsRef.current[columnId] ?? col.defaultWidth;
    const minW = col.minWidth ?? 72;
    const maxW = col.maxWidth ?? 640;
    const startX = clientX;

    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setWidths((prev) => ({
        ...prev,
        [columnId]: clamp(startW + delta, minW, maxW),
      }));
    };
    const onUp = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const colStyle = useCallback(
    (columnId: string): CSSProperties => {
      const w = widths[columnId] ?? defaults.current[columnId] ?? 120;
      return {
        width: w,
        minWidth: w,
        maxWidth: w,
      };
    },
    [widths],
  );

  const resetWidths = useCallback(() => {
    setWidths({ ...defaults.current });
  }, []);

  return { widths, beginResize, colStyle, resetWidths };
}
