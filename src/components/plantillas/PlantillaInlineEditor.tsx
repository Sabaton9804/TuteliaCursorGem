import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table/kit';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  ChevronDown,
  GripVertical,
  Landmark,
  Mail,
  Pencil,
  Plus,
  ListChecks,
  Table2,
  Trash2,
} from 'lucide-react';
import type { DocumentTemplate, DocumentTemplateToggleDef } from '../../types';
import type { PlantillasMembrete } from '../../lib/plantillas-store';
import { ExpedienteVariable } from '../../lib/tiptap-expediente-variable';
import { PlantillaToggleAttrs } from '../../lib/tiptap-plantilla-toggle-attrs';
import { docToStorage, parseStorageToDoc } from '../../lib/tiptap-template-storage';
import {
  etiquetaGrupo,
  etiquetaMarcadorPorClave,
  marcadadorFormateado,
  marcadoresParaPlantilla,
  type GrupoMarcador,
} from '../../lib/plantilla-marcadores-catalog';
import { isBuiltinAutoAdmisorioToggle } from '../../lib/plantilla-template-default-toggles';

/** Datos de arrastre desde fichas → editor (drop en posición del puntero). */
const MIME_PLANTILLA_TOGGLE = 'application/x-tutelia-plantilla-toggle';
const PREFIX_PLANTILLA_TOGGLE = 'tutelia-toggle:';

/** Evita setOptions en bucle: TipTap compara extensiones por referencia. */
function buildPlantillaExtensions(resolveLabel: (key: string) => string) {
  return [
    StarterKit.configure({
      heading: { levels: [3, 4] },
    }),
    TableKit.configure({
      table: {
        resizable: false,
        HTMLAttributes: { class: 'plantilla-tiptap-table' },
      },
    }),
    Underline,
    TextAlign.configure({
      types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
    }),
    PlantillaToggleAttrs,
    ExpedienteVariable.configure({ resolveLabel }),
    Placeholder.configure({ placeholder: 'Escriba el cuerpo del documento…' }),
  ];
}

const TOGGLE_BLOCK_TYPES = ['paragraph', 'heading', 'tableCell', 'tableHeader'] as const;

function readToggleKeyFromEditor(editor: Editor | null): string {
  if (!editor) return '';
  for (const t of TOGGLE_BLOCK_TYPES) {
    if (editor.isActive(t)) {
      const k = editor.getAttributes(t).toggleKey as string | undefined;
      return typeof k === 'string' ? k.trim() : '';
    }
  }
  return '';
}

function applyToggleKeyToSelection(editor: Editor | null, key: string | null) {
  if (!editor) return;
  for (const t of TOGGLE_BLOCK_TYPES) {
    if (editor.isActive(t)) {
      editor.chain().focus().updateAttributes(t, { toggleKey: key }).run();
      return;
    }
  }
}

const GRUPOS_ORDEN: GrupoMarcador[] = ['partes', 'fechas', 'proceso', 'juzgado', 'otros'];

function scrollToPlantillaCuerpo() {
  if (typeof document === 'undefined') return;
  document.getElementById('plantilla-editor-cuerpo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function TemplateToggleOptionsPanel({
  defs,
  onChange,
  disabled,
  onInsertMarker,
}: {
  defs: DocumentTemplateToggleDef[];
  onChange: (next: DocumentTemplateToggleDef[]) => void;
  disabled?: boolean;
  /** Inserta la referencia al bloque en el cursor del cuerpo (pastilla en el editor). */
  onInsertMarker?: (toggleId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (editingId && !defs.some((d) => d.id === editingId)) setEditingId(null);
  }, [defs, editingId]);

  const add = () => {
    const n = defs.length + 1;
    const id = crypto.randomUUID();
    onChange([
      ...defs,
      {
        id,
        label: 'Nueva opción',
        description: 'Breve ayuda para quien marque la casilla en el expediente',
        defaultOn: true,
        blockContent: '',
        documentMarker: `BLOQUE_COND_${n}`,
      },
    ]);
    setEditingId(id);
  };

  const update = (id: string, patch: Partial<DocumentTemplateToggleDef>) => {
    onChange(defs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const remove = (id: string) => {
    if (isBuiltinAutoAdmisorioToggle(id)) return;
    onChange(defs.filter((d) => d.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const editing = editingId ? defs.find((d) => d.id === editingId) : undefined;

  return (
    <div className="mt-3 space-y-3 border-b border-slate-100 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-800">
            Apartados que se pueden activar o no
          </p>
          <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-slate-500">
            Aquí define <strong className="text-slate-700">secciones enteras del escrito</strong> que en el expediente se podrán
            marcar o no (por ejemplo un numeral que a veces aplica y a veces no). Es independiente de los datos sueltos del
            expediente (radicación, partes, etc.) que van como pastillas en el texto.
          </p>
          <p className="mt-1 max-w-xl text-[11px] leading-snug text-slate-500">
            Marque el valor por defecto, use <strong className="font-semibold text-slate-700">Editar</strong> para el texto del
            apartado o <strong className="font-semibold text-slate-700">arrastre ⋮⋮</strong> al párrafo donde va la pastilla.
          </p>
        </div>
        <a
          href="#plantilla-editor-cuerpo"
          onClick={(e) => {
            e.preventDefault();
            scrollToPlantillaCuerpo();
          }}
          className="shrink-0 text-[10px] font-medium text-accent underline-offset-2 hover:underline"
        >
          Ver texto del escrito
        </a>
      </div>

      <details className="rounded-lg border border-slate-200/90 bg-slate-50/50 text-[11px] text-slate-600">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="underline decoration-slate-300 underline-offset-2">
            Ayuda: formato en la barra y opción avanzada «párrafo ↔ casilla»
          </span>
        </summary>
        <div className="space-y-2 border-t border-slate-100 px-3 pb-3 pt-2 leading-snug">
          <p>
            En la barra, el recuadro plegable <strong className="text-slate-800">Avanzado: párrafo ↔ casilla</strong> solo sirve si
            escribió texto <strong className="text-slate-800">sin</strong> usar la pastilla del apartado; si usa la pastilla (⋮⋮), no lo
            necesita.
          </p>
          <p className="text-[10px] text-slate-500">
            Las casillas marcadas <strong className="text-slate-700">«Del modelo»</strong> vienen con el auto admisorio y no se
            borran. Las que dicen <strong className="text-slate-700">«Añadida»</strong> las creó este despacho con «Añadir opción».
          </p>
        </div>
      </details>

      {defs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
          Sin opciones — pulse «Añadir opción».
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {defs.map((d) => {
            const builtin = isBuiltinAutoAdmisorioToggle(d.id);
            const isEditing = editingId === d.id;
            return (
              <li
                key={d.id}
                className={`flex min-w-0 flex-col rounded-lg border bg-white shadow-sm transition ${
                  isEditing ? 'border-accent ring-1 ring-accent/25' : 'border-slate-200/90'
                }`}
              >
                <div className="flex gap-1.5 p-2">
                  <div
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(MIME_PLANTILLA_TOGGLE, d.id);
                      e.dataTransfer.setData('text/plain', `${PREFIX_PLANTILLA_TOGGLE}${d.id}`);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title="Arrastrar al texto del escrito para insertar este apartado aquí"
                    className={`mt-0.5 flex h-8 w-7 shrink-0 cursor-grab flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-accent hover:bg-accent/5 hover:text-accent active:cursor-grabbing ${
                      disabled ? 'pointer-events-none opacity-40' : ''
                    }`}
                    aria-label={`Arrastrar «${d.label}» al documento`}
                  >
                    <GripVertical className="h-4 w-4" aria-hidden />
                  </div>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={d.defaultOn}
                      disabled={disabled}
                      onChange={(e) => update(d.id, { defaultOn: e.target.checked })}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-indigo-600"
                      title="Activo por defecto en el expediente"
                    />
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-slate-900">{d.label}</span>
                      {d.description.trim() ? (
                        <span className="mt-0.5 line-clamp-2 block text-[10px] leading-snug text-slate-500">{d.description}</span>
                      ) : null}
                      <span
                        className={`mt-1 inline-block max-w-full truncate rounded px-1.5 py-px text-[9px] font-bold uppercase ${
                          builtin
                            ? 'bg-emerald-50 text-emerald-900'
                            : 'border border-slate-200 bg-slate-50 text-slate-600'
                        }`}
                        title={
                          builtin
                            ? 'Opción incluida en el modelo estándar de auto admisorio (vinculados / medida provisional)'
                            : 'Opción creada con «Añadir opción» en este despacho'
                        }
                      >
                        {builtin ? 'Del modelo' : 'Añadida'}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex items-center gap-1 border-t border-slate-100 bg-slate-50/60 px-1.5 py-1">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setEditingId(isEditing ? null : d.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[10px] font-semibold text-slate-700 hover:bg-white disabled:opacity-40"
                  >
                    <Pencil className="h-3 w-3" />
                    {isEditing ? 'Cerrar' : 'Editar'}
                  </button>
                  <button
                    type="button"
                    title={builtin ? 'Esta casilla es fija en el auto admisorio' : 'Quitar opción'}
                    disabled={disabled || builtin}
                    onClick={() => remove(d.id)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white p-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
            Editar: <span className="font-semibold normal-case text-slate-900">{editing.label}</span>
          </p>
          <div className="mt-3 space-y-2">
            <label className="block space-y-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Título de la casilla</span>
              <input
                type="text"
                value={editing.label}
                disabled={disabled}
                onChange={(e) => update(editing.id, { label: e.target.value })}
                className="input-modern w-full py-1.5 text-xs"
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Ayuda breve (en el expediente)
              </span>
              <input
                type="text"
                value={editing.description}
                disabled={disabled}
                onChange={(e) => update(editing.id, { description: e.target.value })}
                className="input-modern w-full py-1.5 text-xs"
                placeholder="Ej. Lista de terceros y notificación"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Texto que entra si la casilla está activa
              </span>
              <textarea
                value={editing.blockContent ?? ''}
                disabled={disabled}
                onChange={(e) => update(editing.id, { blockContent: e.target.value })}
                rows={4}
                className="input-modern max-h-48 min-h-[4rem] w-full resize-y py-2 text-xs leading-relaxed"
                placeholder="Escriba aquí el párrafo o numeral. Puede usar datos del expediente desde la barra «Insertar dato»."
              />
            </label>

            <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-2.5 py-2">
              <p className="text-[11px] leading-snug text-indigo-950">
                <strong className="font-semibold">¿Dónde va en el escrito?</strong> Haga clic dentro del cuadro de texto más abajo
                (donde debe aparecer el apartado), luego pulse el botón violeta.
              </p>
              <button
                type="button"
                disabled={disabled || !onInsertMarker}
                onClick={() => {
                  onInsertMarker?.(editing.id);
                  scrollToPlantillaCuerpo();
                }}
                className="btn-primary mt-2 w-full rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"
              >
                Poner este apartado en el texto del escrito
              </button>
            </div>

            <details className="rounded-md border border-slate-200 bg-white text-[11px] text-slate-600">
              <summary className="cursor-pointer px-2 py-1.5 font-medium marker:content-none [&::-webkit-details-marker]:hidden">
                Ajuste técnico del marcador (solo si lo necesita)
              </summary>
              <div className="border-t border-slate-100 px-2 py-2">
                <label className="block space-y-0.5">
                  <span className="text-[10px] text-slate-500">Nombre interno del bloque</span>
                  <input
                    type="text"
                    value={editing.documentMarker ?? ''}
                    disabled={disabled}
                    onChange={(e) =>
                      update(editing.id, {
                        documentMarker: e.target.value.replace(/\s+/g, '_').toUpperCase(),
                      })
                    }
                    className="input-modern w-full py-1 font-mono text-[11px]"
                    spellCheck={false}
                  />
                </label>
              </div>
            </details>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Añadir opción
      </button>
    </div>
  );
}

/** Pastilla con la misma etiqueta legible que en el cuerpo del documento (no muestra {{CLAVE}}). */
function DatoPlantillaPill({ clave }: { clave: string }) {
  const label = etiquetaMarcadorPorClave(clave);
  return (
    <span
      className="inline-flex max-w-[min(100%,18rem)] items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium leading-snug text-violet-950"
      title={`Marcador técnico: ${marcadadorFormateado(clave)}`}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Regla horizontal tipo procesador (aprox. cm sobre ancho A4). */
function PageRuler() {
  const marks = useMemo(() => Array.from({ length: 22 }, (_, i) => i), []);
  return (
    <div
      className="pointer-events-none mb-0 flex h-6 w-full select-none overflow-hidden rounded-t border border-b-0 border-slate-400 bg-gradient-to-b from-slate-100 to-slate-200 text-[9px] leading-none text-slate-600"
      aria-hidden
    >
      {marks.map((n) => (
        <div
          key={n}
          className="relative flex-1 border-l border-slate-400/80 first:border-l-0"
          title={`${n} cm`}
        >
          <span className="absolute left-0.5 top-1">{n % 5 === 0 ? n : ''}</span>
        </div>
      ))}
    </div>
  );
}

function MarcadorInsertMenu({
  porGrupo,
  onInsert,
  disabled,
}: {
  porGrupo: Map<GrupoMarcador, ReturnType<typeof marcadoresParaPlantilla>>;
  onInsert: (key: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 288 });

  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(288, r.width) });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const hasAny = GRUPOS_ORDEN.some((g) => (porGrupo.get(g)?.length ?? 0) > 0);

  const menu =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={menuRef}
        className="fixed z-[9999] max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-2 shadow-xl"
        style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        role="listbox"
        aria-label="Marcadores del expediente"
      >
        {!hasAny ? (
          <p className="px-4 py-3 text-xs text-slate-500">No hay marcadores para este tipo de plantilla.</p>
        ) : (
          GRUPOS_ORDEN.map((g) => {
            const items = porGrupo.get(g);
            if (!items?.length) return null;
            return (
              <div key={g} className="border-b border-slate-100 last:border-b-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {etiquetaGrupo(g)}
                </p>
                <ul className="pb-2">
                  {items.map((m) => (
                    <li key={m.clave}>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-xs text-slate-800 hover:bg-slate-50"
                        onClick={() => {
                          onInsert(m.clave);
                          setOpen(false);
                        }}
                      >
                        <span className="font-medium">{m.etiqueta}</span>
                        <span className="ml-2 font-mono text-[10px] text-violet-700">{`{{${m.clave}}}`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>,
      document.body,
    );

  return (
    <div className="relative min-w-[12rem] shrink-0">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        className="input-modern flex h-8 w-full min-w-[12rem] items-center justify-between gap-2 py-0 pl-3 pr-2 text-left text-xs font-medium text-slate-800 disabled:opacity-40"
      >
        <span className="truncate">Insertar dato del expediente</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
}

type Props = {
  template: DocumentTemplate;
  membrete: PlantillasMembrete;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Definición de toggles (se guarda con la plantilla en Supabase). */
  toggleDefs: DocumentTemplateToggleDef[];
  onToggleDefsChange: (next: DocumentTemplateToggleDef[]) => void;
  onCancel: () => void;
  onSave: (valueFromEditor?: string) => void | Promise<void>;
  saving?: boolean;
  /** Sin contenido en BD: muestra aviso breve bajo la barra de herramientas. */
  showDefaultModelHint?: boolean;
};

export function PlantillaInlineEditor({
  template,
  membrete,
  value,
  onChange,
  disabled,
  toggleDefs,
  onToggleDefsChange,
  onCancel,
  onSave,
  saving,
  showDefaultModelHint,
}: Props) {
  const marcadores = useMemo(() => marcadoresParaPlantilla(template.tipo), [template.tipo]);
  const resolveLabel = useCallback(
    (key: string) => {
      const t = toggleDefs.find(
        (d) =>
          (d.documentMarker?.trim() !== '' && d.documentMarker?.trim() === key) || d.id === key,
      );
      if (t) {
        const dm = t.documentMarker?.trim();
        if (dm) return dm;
        return t.label;
      }
      return marcadores.find((m) => m.clave === key)?.etiqueta ?? key;
    },
    [marcadores, toggleDefs],
  );

  const porGrupo = useMemo(() => {
    const map = new Map<GrupoMarcador, typeof marcadores>();
    for (const m of marcadores) {
      const arr = map.get(m.grupo) ?? [];
      arr.push(m);
      map.set(m.grupo, arr);
    }
    return map;
  }, [marcadores]);

  const extensions = useMemo(() => buildPlantillaExtensions(resolveLabel), [resolveLabel]);

  const toggleDefsRef = useRef(toggleDefs);
  toggleDefsRef.current = toggleDefs;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const editorRef = useRef<Editor | null>(null);

  const plantillaEditorProps = useMemo(
    () => ({
      attributes: {
        class:
          'tiptap-template-focus plantilla-doc-surface px-1 py-0 text-[13px] leading-relaxed text-slate-900 outline-none prose prose-sm max-w-none focus:outline-none',
      },
      handleDOMEvents: {
        dragover(_view, event) {
          const e = event as DragEvent;
          const dt = e.dataTransfer;
          if (!dt || !Array.from(dt.types).includes(MIME_PLANTILLA_TOGGLE)) return false;
          e.preventDefault();
          dt.dropEffect = 'copy';
          return true;
        },
        drop(view, event) {
          const e = event as DragEvent;
          let id = e.dataTransfer?.getData(MIME_PLANTILLA_TOGGLE)?.trim();
          if (!id) {
            const plain = e.dataTransfer?.getData('text/plain');
            if (plain?.startsWith(PREFIX_PLANTILLA_TOGGLE)) {
              id = plain.slice(PREFIX_PLANTILLA_TOGGLE.length).trim();
            }
          }
          if (!id) return false;
          if (disabledRef.current) return true;
          e.preventDefault();
          const d = toggleDefsRef.current.find((x) => x.id === id);
          if (!d) return true;
          const key = (d.documentMarker ?? '').trim() || d.id;
          const coords = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!coords) return true;
          const ed = editorRef.current;
          if (!ed || ed.isDestroyed) return true;
          ed.chain()
            .focus()
            .insertContentAt(coords.pos, { type: 'expedienteVariable', attrs: { key } })
            .run();
          return true;
        },
      },
    }),
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: parseStorageToDoc(value),
      editable: !disabled,
      editorProps: plantillaEditorProps,
      onUpdate: ({ editor: ed }) => {
        onChange(docToStorage(ed.getJSON()));
      },
    },
    /** Recrea el editor si cambian extensiones (p. ej. toggles/marcadores) o bloqueo. */
    [disabled, extensions, plantillaEditorProps],
  );

  editorRef.current = editor;

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let serialized = '';
    try {
      serialized = docToStorage(editor.getJSON());
    } catch {
      return;
    }
    if (serialized === value) return;
    editor.commands.setContent(parseStorageToDoc(value), { emitUpdate: false });
  }, [value, editor]);

  const insertVar = (clave: string) => {
    if (!clave) return;
    editorRef.current?.chain().focus().insertExpedienteVariable(clave).run();
  };

  const tipo = template.tipo;

  return (
    <div className="flex h-[min(86vh,calc(100vh-6rem))] min-h-[280px] flex-col overflow-hidden bg-white md:min-h-[360px]">
      {/* Barra de formato y acciones: no hace scroll */}
      <div className="shrink-0">
        <EditorToolbarRow
          editor={editor}
          disabled={disabled}
          saving={saving}
          porGrupo={porGrupo}
          toggleDefs={toggleDefs}
          onInsert={insertVar}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>

      {showDefaultModelHint ? (
        <p className="shrink-0 border-b border-slate-100/90 px-4 py-2 text-[11px] leading-snug text-slate-500">
          Mostrando modelo estándar del sistema — edita y guarda para fijar tu versión
        </p>
      ) : null}

      {/* Regla alineada al ancho A4: no hace scroll */}
      <div className="shrink-0 border-b border-slate-300 bg-gradient-to-b from-slate-100 to-slate-200/90 px-2 sm:px-4">
        <div className="mx-auto w-full max-w-[210mm]">
          <PageRuler />
        </div>
      </div>

      {/* Solo esta zona hace scroll (comportamiento tipo Word) */}
      <div
        id="plantilla-editor-scroll-region"
        className="plantilla-editor-scroll-region min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-slate-200/70 px-2 py-3 sm:px-4"
      >
        <div className="mx-auto w-full max-w-[210mm]">
          <div className="rounded-b border border-t-0 border-slate-400 bg-white shadow-[0_2px_14px_rgba(15,23,42,0.08)]">
            <div className="box-border min-h-[12rem] px-[clamp(12mm,6vw,22mm)] pb-[clamp(14mm,5vw,20mm)] pt-[clamp(12mm,4vw,18mm)]">
              <MembreteFijo membrete={membrete} />

              {tipo === 'auto_admisorio' ? <MetaAuto /> : null}
              {tipo === 'informe_ingreso' ? <MetaInforme /> : null}

              <TemplateToggleOptionsPanel
                defs={toggleDefs}
                onChange={onToggleDefsChange}
                disabled={disabled}
                onInsertMarker={(toggleId) => {
                  const d = toggleDefs.find((x) => x.id === toggleId);
                  const key = d?.documentMarker?.trim() ? d.documentMarker.trim() : toggleId;
                  editorRef.current?.chain().focus().insertExpedienteVariable(key).run();
                }}
              />

              <p className="mb-2 mt-4 text-[11px] leading-snug text-slate-600">
                <span className="font-semibold text-slate-800">Texto del escrito.</span> Solo esta zona se desplaza; la barra y la
                regla quedan fijas arriba. Para colocar un apartado opcional,{' '}
                <strong className="font-semibold text-slate-800">arrastre ⋮⋮</strong> desde la ficha y suéltelo en el párrafo, o use
                «Poner este apartado…» desde Editar.
              </p>

              <div
                id="plantilla-editor-cuerpo"
                className="plantilla-inline-editor-wrap tiptap-template-editor scroll-mt-6 text-justify"
              >
                <EditorContent
                  editor={editor}
                  className="plantilla-inline-editor min-h-[14rem] pt-3 text-[13px] leading-relaxed text-slate-900"
                />
              </div>

              <p className="mt-6 border-t border-slate-100 pt-3 text-center text-[10px] text-slate-400">
                Las etiquetas de datos del expediente se completan al generar el documento.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Membrete fijo (tres líneas + dirección + correo). */
function MembreteFijo({ membrete }: { membrete: PlantillasMembrete }) {
  const hasImg = Boolean(membrete.membreteImageDataUrl?.trim());
  return (
    <div className="flex flex-col items-center border-b border-slate-100 pb-5 text-center">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        Membrete del despacho (panel administrador)
      </p>
      {hasImg ? (
        <div className="mb-4 flex justify-center">
          <img
            src={membrete.membreteImageDataUrl}
            alt=""
            className="max-h-16 w-auto max-w-full object-contain"
          />
        </div>
      ) : (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-500">
          <Landmark className="h-6 w-6 opacity-60" />
        </div>
      )}
      <p className="mb-4 max-w-md text-center text-xs font-bold uppercase leading-snug text-slate-800">
        {membrete.auto.line1}
        <br />
        {membrete.auto.line2}
        <br />
        {membrete.auto.line3}
      </p>
      <p className="max-w-md text-[10px] leading-snug text-slate-500">{membrete.informe.direccion}</p>
      <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-slate-500">
        <Mail className="h-3 w-3 shrink-0" />
        Correo: {membrete.informe.correo}
      </p>
    </div>
  );
}

function MetaAuto() {
  return (
    <div className="mt-4 space-y-1.5 text-[13px]">
      <p className="text-[10px] text-slate-500">
        Misma vista que en el texto del escrito: cada recuadro es un dato del expediente (pase el cursor para ver el código
        técnico).
      </p>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="min-w-[7rem] text-slate-500">Bogotá D.C.</span>
        <DatoPlantillaPill clave="FECHA_LETRAS" />
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="min-w-[7rem] text-slate-500">Radicación:</span>
        <DatoPlantillaPill clave="RADICACION" />
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="min-w-[7rem] text-slate-500">Proceso:</span>
        <span className="text-slate-800">Acción de Tutela</span>
        <DatoPlantillaPill clave="MEDIDA_PROVISIONAL_TITULO" />
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="min-w-[7rem] text-slate-500">Accionante:</span>
        <DatoPlantillaPill clave="ACCIONANTE" />
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="min-w-[7rem] text-slate-500">Accionado:</span>
        <DatoPlantillaPill clave="ACCIONADO_PRINCIPAL" />
      </div>
    </div>
  );
}

function MetaInforme() {
  return (
    <div className="mt-4 space-y-2 text-center text-[13px]">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-800">Informe de ingreso al despacho</p>
      <p className="mx-auto max-w-md text-[11px] leading-snug text-slate-600">
        Los recuadros morados de esta línea son <strong className="text-slate-800">datos del expediente</strong> (ciudad y fecha)
        que el sistema rellenará al generar el Word. <strong className="text-slate-800">No son casillas de sí/no</strong>: eso es la
        sección «Apartados que se pueden activar o no», más abajo.
      </p>
      <p className="flex flex-wrap items-center justify-center gap-1.5 font-semibold text-slate-900">
        <DatoPlantillaPill clave="CIUDAD" />, <DatoPlantillaPill clave="FECHA_LETRAS_COMPLETA" />
      </p>
    </div>
  );
}

function EditorToolbarRow({
  editor,
  disabled,
  saving,
  porGrupo,
  toggleDefs,
  onInsert,
  onCancel,
  onSave,
}: {
  editor: Editor | null;
  disabled?: boolean;
  saving?: boolean;
  porGrupo: Map<GrupoMarcador, ReturnType<typeof marcadoresParaPlantilla>>;
  toggleDefs: DocumentTemplateToggleDef[];
  onInsert: (key: string) => void;
  onCancel: () => void;
  onSave: (valueFromEditor?: string) => void | Promise<void>;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const fn = () => setTick((x) => x + 1);
    editor.on('selectionUpdate', fn);
    editor.on('transaction', fn);
    return () => {
      editor.off('selectionUpdate', fn);
      editor.off('transaction', fn);
    };
  }, [editor]);

  const tb = (active: boolean) =>
    `flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-md px-2 text-xs font-bold transition ${
      active ? 'bg-indigo-100 text-indigo-950' : 'text-slate-600 hover:bg-slate-100'
    } disabled:opacity-40`;

  if (!editor) {
    return (
      <div className="flex h-11 items-center gap-2 border-b border-slate-200 bg-white px-3 shadow-sm">
        <div className="h-6 flex-1 max-w-md animate-pulse rounded bg-slate-200/80" />
        <div className="ml-auto h-8 w-24 shrink-0 animate-pulse rounded bg-slate-200/80" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[2.75rem] flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5 shadow-sm">
      <button type="button" title="Negrita (N)" disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()} className={tb(editor.isActive('bold'))}>
        <span className="font-serif font-bold">N</span>
      </button>
      <button type="button" title="Cursiva (K)" disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()} className={tb(editor.isActive('italic'))}>
        <span className="font-serif italic">K</span>
      </button>
      <button type="button" title="Subrayado (S)" disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()} className={tb(editor.isActive('underline'))}>
        <span className="font-serif underline decoration-2 underline-offset-2">S</span>
      </button>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <button type="button" title="Alinear a la izquierda" disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('left').run()} className={tb(editor.isActive({ textAlign: 'left' }))}>
        <AlignLeft className="h-4 w-4" />
      </button>
      <button type="button" title="Centrar" disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('center').run()} className={tb(editor.isActive({ textAlign: 'center' }))}>
        <AlignCenter className="h-4 w-4" />
      </button>
      <button type="button" title="Justificar" disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('justify').run()} className={tb(editor.isActive({ textAlign: 'justify' }))}>
        <AlignJustify className="h-4 w-4" />
      </button>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <MarcadorInsertMenu porGrupo={porGrupo} onInsert={onInsert} disabled={disabled} />

      {toggleDefs.length > 0 ? (
        <details
          className={`group min-w-0 max-w-[min(100%,18rem)] shrink-0 rounded-lg border px-1.5 py-0.5 sm:max-w-[22rem] ${
            readToggleKeyFromEditor(editor)
              ? 'border-amber-300 bg-amber-50/90'
              : 'border-slate-200/90 bg-slate-50/90'
          }`}
        >
          <summary
            className="flex cursor-pointer list-none items-center gap-1 py-1 text-[10px] font-semibold leading-tight text-slate-700 marker:content-none [&::-webkit-details-marker]:hidden"
            title="Casi siempre basta con insertar la pastilla del apartado (⋮⋮). Esto es solo para párrafos escritos a mano sin pastilla."
          >
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
            <span className="min-w-0 flex-1 text-left">
              Avanzado: párrafo ↔ casilla
              {readToggleKeyFromEditor(editor) ? (
                <span className="ml-1 rounded bg-amber-200/90 px-1 text-[9px] font-bold uppercase text-amber-950">
                  ligado
                </span>
              ) : null}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex flex-col gap-1 border-t border-slate-200/80 pb-1 pt-1.5">
            <p className="text-[9px] leading-snug text-slate-600">
              Si ya metió la <strong className="text-slate-800">pastilla del apartado</strong> en el texto, no hace falta esto: la
              casilla ya decide si ese bloque va o no. Use esto solo si escribió texto largo <strong className="text-slate-800">sin</strong>{' '}
              pastilla y quiere que <strong className="text-slate-800">todo el párrafo</strong> dependa de una casilla.
            </p>
            <label className="sr-only" htmlFor="plantilla-condicional-select">
              Enlazar párrafo a casilla del expediente al generar
            </label>
            <select
              id="plantilla-condicional-select"
              disabled={disabled}
              value={readToggleKeyFromEditor(editor)}
              onChange={(e) => {
                const v = e.target.value;
                applyToggleKeyToSelection(editor, v.trim() ? v : null);
              }}
              className="h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-900 disabled:opacity-40"
            >
              <option value="">Siempre va</option>
              {toggleDefs.map((d) => (
                <option key={d.id} value={d.id}>
                  Solo si activaron «{d.label}»
                </option>
              ))}
            </select>
          </div>
        </details>
      ) : null}

      <button
        type="button"
        title="Insertar tabla (3×3 con encabezado)"
        disabled={disabled}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        className={tb(false)}
      >
        <Table2 className="h-4 w-4" />
      </button>
      {editor.isActive('table') ? (
        <button
          type="button"
          title="Eliminar tabla"
          disabled={disabled}
          onClick={() => editor.chain().focus().deleteTable().run()}
          className="flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-md px-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}

      <span className="min-w-2 flex-1" aria-hidden />

      <button type="button" disabled={disabled} onClick={onCancel} className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40">
        Cancelar
      </button>
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => {
          const current = editor ? docToStorage(editor.getJSON()) : undefined;
          void onSave(current);
        }}
        className="btn-primary shrink-0 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wide disabled:opacity-40"
      >
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}
