import type { CSSProperties, ReactNode } from 'react';

type Props = {
  label: ReactNode;
  style: CSSProperties;
  onResizeStart: (clientX: number) => void;
  /** Última columna: sin asa (opcional; por defecto sí tiene). */
  showHandle?: boolean;
};

/** Encabezado de tabla con asa derecha para arrastrar el ancho (estilo Excel). */
export function ResizableTh({ label, style, onResizeStart, showHandle = true }: Props) {
  return (
    <th
      className="relative px-4 py-3 select-none"
      style={style}
      scope="col"
    >
      <span className="block truncate pr-2">{label}</span>
      {showHandle ? (
        <button
          type="button"
          aria-label="Redimensionar columna"
          title="Arrastre para ampliar o reducir"
          className="absolute inset-y-0 right-0 z-10 w-3 cursor-col-resize border-0 bg-transparent p-0 after:absolute after:inset-y-2 after:right-1 after:w-px after:bg-slate-200 after:content-[''] hover:after:bg-accent/70 active:after:bg-accent"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onResizeStart(e.clientX);
          }}
          onClick={(e) => e.preventDefault()}
        />
      ) : null}
    </th>
  );
}
