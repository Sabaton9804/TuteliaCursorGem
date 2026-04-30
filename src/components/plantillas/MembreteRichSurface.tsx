import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { NodeSelection } from '@tiptap/pm/state';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  ImagePlus,
  Italic,
  Underline as UnderlineIcon,
} from 'lucide-react';
import type { PlantillasMembrete } from '../../lib/plantillas-store';
import { defaultMembreteDocFromStruct, parseMembreteEditorJson } from '../../lib/membrete-rich-doc';
import { readImageFileAsDataUrl } from '../../lib/plantillas-store';
import { PAGE_FONT_CHOICES } from '../../lib/page-font-choices';
import { MembreteParagraph, MEMBRETE_PARAGRAPH_SPACE_PT } from '../../lib/tiptap-membrete-paragraph-spacing';

const MEMBRETE_TOOLBAR_SELECT =
  'h-9 shrink-0 rounded-md border border-slate-200 bg-white px-2.5 font-sans text-sm text-slate-900 shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-40';

const MEMBRETE_PT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18] as const;

/** Anchos típicos del escudo en px (alto se deriva de la proporción guardada o 1:1). */
const MEMBRETE_IMG_WIDTH_PRESETS = [96, 128, 160, 200, 260] as const;

function isImageNodeSelection(sel: unknown): sel is NodeSelection {
  return sel instanceof NodeSelection && sel.node.type.name === 'image';
}

function membreteImageAttrs(sel: NodeSelection) {
  const a = sel.node.attrs as { width?: number | string | null; height?: number | string | null };
  const w = Number(a.width);
  const h = Number(a.height);
  const wOk = Number.isFinite(w) && w > 0 ? w : null;
  const hOk = Number.isFinite(h) && h > 0 ? h : null;
  return { w: wOk, h: hOk };
}

function MembreteImageSizeBar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((x) => x + 1);
    editor.on('selectionUpdate', fn);
    editor.on('transaction', fn);
    return () => {
      editor.off('selectionUpdate', fn);
      editor.off('transaction', fn);
    };
  }, [editor]);

  const sel = editor.state.selection;
  if (!isImageNodeSelection(sel)) return null;

  const { w, h } = membreteImageAttrs(sel);
  const ratio = w != null && h != null && h > 0 ? w / h : 1;

  const applyWidth = (widthPx: number) => {
    const heightPx = Math.max(32, Math.round(widthPx / ratio));
    editor.chain().focus().updateAttributes('image', { width: widthPx, height: heightPx }).run();
  };

  const clearSize = () => {
    editor.chain().focus().updateAttributes('image', { width: null, height: null }).run();
  };

  const imgBtn = (active: boolean) =>
    `flex h-8 min-w-[2.35rem] shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-bold tabular-nums transition ${
      active ? 'bg-emerald-100 text-emerald-950' : 'text-slate-600 hover:bg-slate-100'
    } disabled:opacity-40`;

  return (
    <>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
      <span className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:inline">Escudo</span>
      {MEMBRETE_IMG_WIDTH_PRESETS.map((px) => (
        <button
          key={px}
          type="button"
          title={`Ancho aproximado ${px}px`}
          disabled={disabled}
          onClick={() => applyWidth(px)}
          className={imgBtn(w != null && Math.abs(w - px) < 6)}
        >
          {px}
        </button>
      ))}
      <button
        type="button"
        title="Quitar tamaño fijo (tamaño natural de la imagen)"
        disabled={disabled}
        onClick={() => clearSize()}
        className={imgBtn(w == null && h == null)}
      >
        Auto
      </button>
    </>
  );
}

function MembreteRichTypographyBar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((x) => x + 1);
    editor.on('selectionUpdate', fn);
    editor.on('transaction', fn);
    return () => {
      editor.off('selectionUpdate', fn);
      editor.off('transaction', fn);
    };
  }, [editor]);

  const a = editor.getAttributes('textStyle') as { fontFamily?: string | null; fontSize?: string | null };
  const fontValue = (a.fontFamily?.trim() || 'Times New Roman').replace(/^['"]|['"]$/g, '');
  const sizePt = (() => {
    const raw = a.fontSize?.trim();
    if (!raw) return 12;
    const m = raw.match(/^([\d.]+)\s*pt$/i);
    return m ? Number(m[1]) : 12;
  })();
  const sizeInList = MEMBRETE_PT_SIZES.some((p) => p === sizePt);
  const sizeStr = String(sizePt);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="flex min-w-0 shrink-0 items-center gap-1">
        <span className="hidden text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:inline">Letra</span>
        <select
          disabled={disabled}
          value={fontValue}
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          className={`${MEMBRETE_TOOLBAR_SELECT} min-w-[12rem] max-w-[min(100%,16rem)]`}
          style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
        >
          {!PAGE_FONT_CHOICES.includes(fontValue) ? <option value={fontValue}>{fontValue}</option> : null}
          {PAGE_FONT_CHOICES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="flex shrink-0 items-center gap-1">
        <span className="hidden text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:inline">Pt</span>
        <select
          disabled={disabled}
          value={sizeStr}
          onChange={(e) => editor.chain().focus().setFontSize(`${e.target.value}pt`).run()}
          className={`${MEMBRETE_TOOLBAR_SELECT} w-[3.75rem] min-w-[3.75rem] tabular-nums`}
          style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
        >
          {!sizeInList ? (
            <option value={sizeStr}>
              {sizeStr}
            </option>
          ) : null}
          {MEMBRETE_PT_SIZES.map((pt) => (
            <option key={pt} value={String(pt)}>
              {pt}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Espacio antes / después del párrafo (equivalente a Word: «Agregar espacio antes/después del párrafo»). */
function MembreteParagraphSpacingBar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((x) => x + 1);
    editor.on('selectionUpdate', fn);
    editor.on('transaction', fn);
    return () => {
      editor.off('selectionUpdate', fn);
      editor.off('transaction', fn);
    };
  }, [editor]);

  const pa = editor.getAttributes('paragraph') as {
    paragraphMarginBefore?: string | null;
    paragraphMarginAfter?: string | null;
  };
  const beforeOn = Boolean(pa.paragraphMarginBefore);
  const afterOn = Boolean(pa.paragraphMarginAfter);
  const pt = MEMBRETE_PARAGRAPH_SPACE_PT;

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <span className="hidden shrink-0 pl-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:inline">
        Espacio
      </span>
      <button
        type="button"
        title={`Agregar o quitar espacio antes del párrafo (${pt} pt)`}
        disabled={disabled || !editor.isActive('paragraph')}
        onClick={() => editor.chain().focus().toggleMembreteSpaceBefore().run()}
        className={tb(beforeOn)}
      >
        <BetweenVerticalStart className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        title={`Agregar o quitar espacio después del párrafo (${pt} pt)`}
        disabled={disabled || !editor.isActive('paragraph')}
        onClick={() => editor.chain().focus().toggleMembreteSpaceAfter().run()}
        className={tb(afterOn)}
      >
        <BetweenVerticalEnd className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function buildMembreteExtensions(opts?: { imageResize?: boolean }) {
  const imageResize = opts?.imageResize !== false;
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      underline: false,
      paragraph: false,
    }),
    MembreteParagraph,
    Underline,
    TextStyle,
    FontFamily,
    FontSize,
    TextAlign.configure({
      // La imagen va inline dentro del párrafo; el centrado es `textAlign` del `<p>`.
      types: ['heading', 'paragraph'],
    }),
    Image.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: {
        class: 'membrete-editor-img max-w-full h-auto',
      },
      ...(imageResize
        ? {
            resize: {
              enabled: true,
              minWidth: 32,
              minHeight: 32,
              alwaysPreserveAspectRatio: true,
            },
          }
        : {}),
    }),
    Placeholder.configure({
      placeholder: 'Texto del membrete, imágenes donde quiera…',
    }),
  ];
}

const tb = (active: boolean) =>
  `flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-md px-2 text-xs font-bold transition ${
    active ? 'bg-indigo-100 text-indigo-950' : 'text-slate-600 hover:bg-slate-100'
  } disabled:opacity-40`;

type MembreteRichEditorProps = {
  membrete: PlantillasMembrete;
  /** JSON stringificado del documento TipTap; null = solo plantilla desde campos clásicos hasta el primer guardado. */
  value: string | null | undefined;
  onChange: (json: string) => void;
  disabled?: boolean;
};

/**
 * Editor relajado del membrete (texto, negrita, alineación, imágenes embebidas en base64).
 */
export function MembreteRichEditor({ membrete, value, onChange, disabled }: MembreteRichEditorProps) {
  const extensions = useMemo(() => buildMembreteExtensions({ imageResize: true }), []);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPersistedJsonRef = useRef<string | undefined>(value ?? undefined);
  const emit = useCallback(
    (json: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onChange(json), 450);
    },
    [onChange],
  );

  const initialContent = useMemo(
    () => parseMembreteEditorJson(value ?? null) ?? defaultMembreteDocFromStruct(membrete),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primer contenido: JSON guardado o plantilla desde struct
    [value, membrete],
  );

  const editor = useEditor(
    {
      extensions,
      content: initialContent,
      editable: !disabled,
      onUpdate: ({ editor: ed }) => {
        emit(JSON.stringify(ed.getJSON()));
      },
    },
    [extensions],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  /**
   * Sincronizar con el JSON guardado (`value`) cuando viene de fuera (otro navegador o recarga).
   * No reaccionar a `membrete` solo: evita borrar tipografía al cambiar líneas del formulario clásico.
   * Si el usuario borra el diseño libre (cadena vacía), volver a la plantilla desde struct.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const raw = (value ?? '').trim();
    const prevTrimmed = (prevPersistedJsonRef.current ?? '').trim();

    if (!raw) {
      if (prevTrimmed) {
        editor.commands.setContent(defaultMembreteDocFromStruct(membrete), { emitUpdate: false });
      }
      prevPersistedJsonRef.current = value;
      return;
    }

    const parsed = parseMembreteEditorJson(raw);
    if (!parsed) {
      prevPersistedJsonRef.current = value;
      return;
    }
    const cur = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(parsed);
    if (cur !== incoming) {
      editor.commands.setContent(parsed, { emitUpdate: false });
    }
    prevPersistedJsonRef.current = value;
  }, [editor, value, membrete]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const insertImageFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor || disabled) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      editor.chain().focus().setImage({ src: dataUrl }).setTextAlign('center').run();
    } catch {
      /* toast opcional */
    }
  };

  if (!editor) {
    return (
      <div className="min-h-[10rem] rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-500">
        Cargando editor…
      </div>
    );
  }

  return (
    <div className="overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex min-h-[2.75rem] flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50/90 px-2 py-1.5">
        <button
          type="button"
          title="Negrita"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={tb(editor.isActive('bold'))}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Cursiva"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={tb(editor.isActive('italic'))}
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Subrayado"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={tb(editor.isActive('underline'))}
        >
          <UnderlineIcon className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
        <MembreteRichTypographyBar editor={editor} disabled={disabled} />
        <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
        <button type="button" title="Izquierda" disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('left').run()} className={tb(editor.isActive({ textAlign: 'left' }))}>
          <AlignLeft className="h-4 w-4" />
        </button>
        <button type="button" title="Centrar" disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('center').run()} className={tb(editor.isActive({ textAlign: 'center' }))}>
          <AlignCenter className="h-4 w-4" />
        </button>
        <button type="button" title="Derecha" disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('right').run()} className={tb(editor.isActive({ textAlign: 'right' }))}>
          <AlignRight className="h-4 w-4" />
        </button>
        <button type="button" title="Justificar" disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('justify').run()} className={tb(editor.isActive({ textAlign: 'justify' }))}>
          <AlignJustify className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
        <MembreteParagraphSpacingBar editor={editor} disabled={disabled} />
        <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40">
          <ImagePlus className="h-4 w-4 text-accent" />
          Imagen
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={disabled} onChange={(ev) => void insertImageFromFile(ev)} />
        </label>
        <MembreteImageSizeBar editor={editor} disabled={disabled} />
      </div>
      <EditorContent
        editor={editor}
        className="membrete-rich-editor max-h-[min(50vh,28rem)] min-h-[12rem] overflow-x-auto overflow-y-auto bg-white px-3 py-6 text-sm text-slate-900 [&_.ProseMirror]:min-h-[11rem] [&_.ProseMirror]:overflow-visible [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}

/** Vista previa de solo lectura (plantillas y expediente): mismo documento que el editor. */
export function MembreteRichPreview({
  membrete,
  embedded,
}: {
  membrete: PlantillasMembrete;
  /** Sin título ni caja gris: para incrustar dentro de otra “hoja” (p. ej. borrador en expediente). */
  embedded?: boolean;
}) {
  const extensions = useMemo(() => buildMembreteExtensions({ imageResize: false }), []);
  const content = useMemo(
    () => parseMembreteEditorJson(membrete.membreteEditorJson) ?? defaultMembreteDocFromStruct(membrete),
    [membrete],
  );

  const editor = useEditor({
    extensions,
    content,
    editable: false,
    editorProps: { attributes: { class: 'outline-none' } },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const next = parseMembreteEditorJson(membrete.membreteEditorJson) ?? defaultMembreteDocFromStruct(membrete);
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, membrete]);

  if (!editor) {
    return <div className={embedded ? 'h-16 animate-pulse rounded-md bg-slate-100/80' : 'h-24 animate-pulse rounded-lg bg-slate-100'} />;
  }

  const inner = (
    <div
      className={
        embedded
          ? 'px-0 py-1 text-[13px] text-slate-900 [&_.ProseMirror]:outline-none [&_.ProseMirror_img]:mx-auto [&_.ProseMirror_img]:max-h-[min(16rem,55vh)] [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:object-contain [&_.ProseMirror_img]:h-auto'
          : 'rounded-lg border border-slate-100 bg-slate-50/50 px-2 py-2 text-[13px] text-slate-800 [&_.ProseMirror]:outline-none [&_.ProseMirror_img]:mx-auto [&_.ProseMirror_img]:max-h-[min(20rem,65vh)] [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:object-contain [&_.ProseMirror_img]:h-auto'
      }
    >
      <EditorContent editor={editor} />
    </div>
  );

  if (embedded) {
    return <div className="border-b border-slate-200/90 pb-3">{inner}</div>;
  }

  return (
    <div className="border-b border-slate-100 pb-4">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">Membrete del despacho</p>
      {inner}
    </div>
  );
}
