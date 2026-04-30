import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  ChevronDown,
  GripVertical,
  Mail,
  Pencil,
  Plus,
  ListChecks,
  Table2,
  Trash2,
  Layout,
  Settings,
} from 'lucide-react';
import type { DocumentTemplate, DocumentTemplatePageLayout, DocumentTemplateToggleDef } from '../../types';
import { PAGE_MARGIN_PRESETS, matchMarginPresetId } from '../../lib/document-template-page-layout';
import { PAGE_FONT_CHOICES } from '../../lib/page-font-choices';
import type { PlantillasMembrete } from '../../lib/plantillas-store';
import { MembreteRichPreview } from './MembreteRichSurface';
import { ExpedienteVariable } from '../../lib/tiptap-expediente-variable';
import { buildPlantillaBodyExtensions } from '../../lib/tiptap-plantilla-editor-extensions';
import { defaultAutoDatosExpedienteDocStorage } from '../../lib/auto-datos-expediente-defaults';
import {
  docToStorage,
  parseStorageToDoc,
  type ParseStorageOptions,
} from '../../lib/tiptap-template-storage';
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

/** Bloque corto bajo el membrete (auto admisorio): sin tablas ni casillas de apartado. */
function buildAutoMetaExtensions(resolveLabel: (key: string) => string) {
  return [
    StarterKit.configure({
      heading: { levels: [3, 4] },
      underline: false,
    }),
    Underline,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    ExpedienteVariable.configure({ resolveLabel }),
    Placeholder.configure({ placeholder: 'Etiquetas y datos del expediente (pastillas moradas)…' }),
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

/** Ancho de página A4 en mm (regla horizontal). */
const RULER_PAGE_WIDTH_MM = 210;
const RULER_MARGIN_MIN_MM = 10;
const RULER_MARGIN_MAX_MM = 60;
const RULER_MIN_BODY_MM = 35;

function clampHorizontalMarginMm(n: number, maxAllowed: number): number {
  return Math.min(maxAllowed, Math.max(RULER_MARGIN_MIN_MM, Math.round(n * 2) / 2));
}

/** Marcas cada 5 mm (~0,5 cm); números cada cm en HTML (9px) para no deformar el texto. */
const RULER_TICK_STEP_MM = 5;

/**
 * Regla compacta estilo Microsoft Word: 22px, fondo #f0f0f0, marcas cortas, márgenes arrastrables (8px).
 */
function HorizontalPageRuler({
  layout,
  onChange,
  disabled,
}: {
  layout: DocumentTemplatePageLayout;
  onChange: (next: DocumentTemplatePageLayout) => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [drag, setDrag] = useState<'left' | 'right' | null>(null);
  const dragStartRef = useRef({ clientX: 0, left: 0, right: 0 });

  const { left, right } = layout.marginMm;
  const leftPct = (left / RULER_PAGE_WIDTH_MM) * 100;
  const textRightPct = ((RULER_PAGE_WIDTH_MM - right) / RULER_PAGE_WIDTH_MM) * 100;

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const W = track.getBoundingClientRect().width;
      if (W < 8) return;
      const deltaMm = ((e.clientX - dragStartRef.current.clientX) / W) * RULER_PAGE_WIDTH_MM;
      const L = layoutRef.current;
      const startL = dragStartRef.current.left;
      const startR = dragStartRef.current.right;
      if (drag === 'left') {
        const maxLeft = Math.min(RULER_MARGIN_MAX_MM, RULER_PAGE_WIDTH_MM - startR - RULER_MIN_BODY_MM);
        const nextLeft = clampHorizontalMarginMm(startL + deltaMm, maxLeft);
        onChange({ ...L, marginMm: { ...L.marginMm, left: nextLeft } });
      } else {
        const maxRight = Math.min(RULER_MARGIN_MAX_MM, RULER_PAGE_WIDTH_MM - startL - RULER_MIN_BODY_MM);
        const nextRight = clampHorizontalMarginMm(startR - deltaMm, maxRight);
        onChange({ ...L, marginMm: { ...L.marginMm, right: nextRight } });
      }
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, onChange]);

  const startLeftDrag = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragStartRef.current = { clientX: e.clientX, left: layout.marginMm.left, right: layout.marginMm.right };
    setDrag('left');
  };

  const startRightDrag = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragStartRef.current = { clientX: e.clientX, left: layout.marginMm.left, right: layout.marginMm.right };
    setDrag('right');
  };

  const tickLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    for (let mm = 0; mm <= RULER_PAGE_WIDTH_MM; mm += RULER_TICK_STEP_MM) {
      const isCm = mm % 10 === 0;
      const tickH = isCm ? 4 : 3;
      lines.push(
        <line
          key={mm}
          x1={mm}
          y1={6}
          x2={mm}
          y2={6 - tickH}
          stroke="#999"
          strokeWidth={0.35}
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
    return lines;
  }, []);

  return (
    <div
      ref={trackRef}
      className={`relative mb-0 h-[22px] max-h-[22px] w-full shrink-0 select-none overflow-hidden rounded-t-sm border border-b-0 border-neutral-400/55 bg-[#f0f0f0] ${
        disabled ? 'pointer-events-none opacity-80' : ''
      }`}
      role="presentation"
      aria-label="Regla de márgenes en centímetros (ancho A4)"
    >
      {/* Límites de margen (solo guía, sin franjas anchas) */}
      <div
        className="pointer-events-none absolute bottom-0 top-0 z-[1] w-px bg-neutral-400/50"
        style={{ left: `${leftPct}%` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 top-0 z-[1] w-px bg-neutral-400/50"
        style={{ left: `${textRightPct}%` }}
        aria-hidden
      />

      {/* Números cada 1 cm; posición alineada a marcas de 0,5 cm */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[13px] overflow-hidden leading-none">
        {Array.from({ length: 20 }, (_, i) => {
          const cm = i + 1;
          const leftPercent = (cm * 10 * 100) / RULER_PAGE_WIDTH_MM;
          return (
            <span
              key={cm}
              className="absolute top-px -translate-x-1/2 font-sans tabular-nums"
              style={{
                left: `${leftPercent}%`,
                fontSize: '9px',
                color: '#666',
                lineHeight: '11px',
              }}
            >
              {cm}
            </span>
          );
        })}
      </div>

      {/* Marcas cada ~0,5 cm: líneas de 3–4 px */}
      <svg
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] block h-[6px] w-full"
        viewBox="0 0 210 6"
        preserveAspectRatio="none"
        aria-hidden
      >
        {tickLines}
      </svg>

      {!disabled ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={startLeftDrag}
            className="absolute bottom-0 z-20 flex h-[22px] w-3 -translate-x-1/2 cursor-col-resize items-end justify-center border-0 bg-transparent p-0"
            style={{ left: `${leftPct}%` }}
            title="Margen izquierdo — arrastre"
            aria-label="Ajustar margen izquierdo arrastrando"
          >
            <svg width={8} height={8} viewBox="0 0 8 8" className="shrink-0" aria-hidden>
              <polygon points="4,0 8,4.5 0,4.5" fill="#f8f8f8" stroke="#555" strokeWidth="0.5" />
              <rect x="2.5" y="4.5" width="3" height="3.5" fill="#f8f8f8" stroke="#555" strokeWidth="0.5" />
            </svg>
          </button>
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={startRightDrag}
            className="absolute bottom-0 z-20 flex h-[22px] w-3 -translate-x-1/2 cursor-col-resize items-end justify-center border-0 bg-transparent p-0"
            style={{ left: `${textRightPct}%` }}
            title="Margen derecho — arrastre"
            aria-label="Ajustar margen derecho arrastrando"
          >
            <svg width={8} height={8} viewBox="0 0 8 8" className="shrink-0" aria-hidden>
              <polygon points="4,8 8,2 0,2" fill="#f8f8f8" stroke="#555" strokeWidth="0.5" />
            </svg>
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Miniatura de página para cada preajuste de márgenes (como iconos de Word). */
function MarginPresetThumb({ marginMm }: { marginMm: DocumentTemplatePageLayout['marginMm'] }) {
  const maxRef = 56;
  const box = 36;
  const t = (mm: number) => `${Math.min(11, (mm / maxRef) * (box * 0.45))}px`;
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded border border-slate-400 bg-white shadow-sm"
      style={{ width: box * 0.72, height: box }}
      aria-hidden
    >
      <div
        className="absolute bg-slate-100"
        style={{
          top: t(marginMm.top),
          right: t(marginMm.right),
          bottom: t(marginMm.bottom),
          left: t(marginMm.left),
        }}
      />
    </div>
  );
}

/** Evita `input-modern` (incluye `w-full`): en la barra flex colapsaba el ancho y el select mostraba el texto recortado. */
const toolbarSelectClass =
  'h-9 shrink-0 rounded-md border border-slate-200 bg-white px-2.5 font-sans text-sm text-slate-900 shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-40';

function PageTypographyBar({
  layout,
  onChange,
  disabled,
}: {
  layout: DocumentTemplatePageLayout;
  onChange: (next: DocumentTemplatePageLayout) => void;
  disabled?: boolean;
}) {
  const fontValue = layout.fontFamily?.trim() || 'Times New Roman';
  const sizeValue = String(layout.fontSizePt);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="flex min-w-0 shrink-0 items-center gap-1">
        <span className="hidden text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:inline">Letra</span>
        <select
          disabled={disabled}
          value={fontValue}
          onChange={(e) => onChange({ ...layout, fontFamily: e.target.value })}
          className={`${toolbarSelectClass} min-w-[15rem] max-w-[min(100%,18rem)]`}
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
          value={sizeValue}
          onChange={(e) => onChange({ ...layout, fontSizePt: Number(e.target.value) })}
          className={`${toolbarSelectClass} w-[3.75rem] min-w-[3.75rem] tabular-nums`}
          style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
        >
          {[8, 9, 10, 11, 12, 13, 14, 16, 18].map((pt) => (
            <option key={pt} value={String(pt)}>
              {pt}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function MarginsWordMenu({
  layout,
  onChange,
  disabled,
}: {
  layout: DocumentTemplatePageLayout;
  onChange: (next: DocumentTemplatePageLayout) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const presetId = matchMarginPresetId(layout.marginMm);
  const buttonSubtitle = presetId
    ? PAGE_MARGIN_PRESETS.find((p) => p.id === presetId)?.label ?? 'Márgenes'
    : 'Personalizado';

  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.max(8, r.left + r.width - 320) });
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
      setCustomOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const applyPreset = (marginMm: DocumentTemplatePageLayout['marginMm']) => {
    onChange({ ...layout, marginMm: { ...marginMm } });
    setCustomOpen(false);
    setOpen(false);
  };

  const mmField = (label: string, k: keyof DocumentTemplatePageLayout['marginMm']) => (
    <label key={k} className="flex flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="number"
        min={10}
        max={60}
        step={0.5}
        disabled={disabled}
        value={layout.marginMm[k]}
        onChange={(e) => {
          const n = Number(e.target.value);
          const v = Number.isFinite(n) ? Math.min(60, Math.max(10, n)) : layout.marginMm[k];
          onChange({ ...layout, marginMm: { ...layout.marginMm, [k]: v } });
        }}
        className="input-modern h-8 w-full px-2 py-0 text-xs tabular-nums disabled:opacity-40"
      />
    </label>
  );

  const menu =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={menuRef}
        className="fixed z-[10000] w-[min(100vw-16px,320px)] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
        style={{ top: pos.top, left: pos.left }}
        role="menu"
        aria-label="Márgenes de página"
      >
        <p className="border-b border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Márgenes de la hoja
        </p>
        <ul className="max-h-[min(70vh,420px)] overflow-y-auto py-1">
          {PAGE_MARGIN_PRESETS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => applyPreset(p.marginMm)}
                className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:opacity-40 ${
                  presetId === p.id ? 'bg-indigo-50/90' : ''
                }`}
              >
                <MarginPresetThumb marginMm={p.marginMm} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{p.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{p.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCustomOpen((c) => !c)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-accent hover:bg-slate-50 disabled:opacity-40"
          >
            <Settings className="h-4 w-4 shrink-0" aria-hidden />
            Márgenes personalizados…
          </button>
          {customOpen ? (
            <div className="border-t border-slate-100 bg-slate-50/90 px-3 pb-3 pt-2">
              <p className="mb-2 text-[10px] leading-snug text-slate-600">
                Se aplican al borde de la hoja A4 (como en Word). Unidades: milímetros.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {mmField('Superior', 'top')}
                {mmField('Inferior', 'bottom')}
                {mmField('Izquierdo', 'left')}
                {mmField('Derecho', 'right')}
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setCustomOpen(false);
                  setOpen(false);
                }}
                className="btn-primary mt-3 w-full rounded-md py-2 text-xs font-semibold uppercase tracking-wide disabled:opacity-40"
              >
                Listo
              </button>
            </div>
          ) : null}
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        title="Márgenes de la hoja (como Disposición → Márgenes en Word)"
        className="flex h-9 max-w-[13rem] shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white py-0 pl-2 pr-2 text-left font-sans text-[11px] font-medium text-slate-800 shadow-sm outline-none transition hover:bg-slate-50 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-40"
      >
        <Layout className="h-4 w-4 shrink-0 text-slate-600" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="block truncate leading-tight">Márgenes</span>
          <span className="block truncate text-[9px] font-normal text-slate-500">{buttonSubtitle}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
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
  /** Márgenes y tipografía por plantilla (estado controlado desde la página). */
  pageLayout: DocumentTemplatePageLayout;
  onPageLayoutChange: (next: DocumentTemplatePageLayout) => void;
  /** Auto admisorio: persiste bloque «datos del expediente» en branding del despacho. */
  onAutoDatosExpedienteEditorJsonChange?: (json: string) => void;
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
  pageLayout,
  onPageLayoutChange,
  onAutoDatosExpedienteEditorJsonChange,
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

  const parseDocOpts = useMemo((): ParseStorageOptions | undefined => {
    if (template.tipo === 'informe_ingreso') return { informeCuerpoJustifyDefecto: true };
    return undefined;
  }, [template.tipo]);

  const extensions = useMemo(() => buildPlantillaBodyExtensions(resolveLabel), [resolveLabel]);

  const toggleDefsRef = useRef(toggleDefs);
  toggleDefsRef.current = toggleDefs;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const editorRef = useRef<Editor | null>(null);

  const plantillaEditorProps = useMemo(
    () => ({
      attributes: {
        class:
          'tiptap-template-focus plantilla-doc-surface px-1 py-0 text-inherit leading-relaxed text-slate-900 outline-none prose prose-sm max-w-none focus:outline-none',
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
      content: parseStorageToDoc(value, parseDocOpts),
      editable: !disabled,
      editorProps: plantillaEditorProps,
      onUpdate: ({ editor: ed }) => {
        onChange(docToStorage(ed.getJSON()));
      },
    },
    /** Recrea el editor si cambian extensiones (p. ej. toggles/marcadores) o bloqueo. */
    [disabled, extensions, plantillaEditorProps, parseDocOpts],
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
    let normalizedValue = value;
    try {
      normalizedValue = docToStorage(parseStorageToDoc(value, parseDocOpts));
    } catch {
      /* mantener value */
    }
    if (serialized === normalizedValue) return;
    editor.commands.setContent(parseStorageToDoc(value, parseDocOpts), { emitUpdate: false });
  }, [value, editor, parseDocOpts]);

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
          pageLayout={pageLayout}
          onPageLayoutChange={onPageLayoutChange}
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
      <div className="shrink-0 border-b border-slate-300/80 bg-slate-200/40 px-0 sm:px-2">
        <div className="mx-auto w-full max-w-[210mm]">
          <HorizontalPageRuler layout={pageLayout} onChange={onPageLayoutChange} disabled={disabled} />
        </div>
      </div>

      {/* Solo esta zona hace scroll (comportamiento tipo Word) */}
      <div
        id="plantilla-editor-scroll-region"
        className="plantilla-editor-scroll-region min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-slate-200/70 px-2 py-3 sm:px-4"
      >
        <div className="mx-auto w-full max-w-[210mm]">
          <div className="rounded-b border border-t-0 border-slate-400 bg-white shadow-[0_2px_14px_rgba(15,23,42,0.08)]">
            <div
              className="box-border min-h-[12rem]"
              style={{
                paddingTop: `${pageLayout.marginMm.top}mm`,
                paddingRight: `${pageLayout.marginMm.right}mm`,
                paddingBottom: `${pageLayout.marginMm.bottom}mm`,
                paddingLeft: `${pageLayout.marginMm.left}mm`,
                fontFamily: pageLayout.fontFamily,
                fontSize: `${pageLayout.fontSizePt}pt`,
              }}
            >
              <MembreteRichPreview membrete={membrete} />

              {tipo === 'auto_admisorio' ? (
                <AutoDatosExpedienteBlock
                  membrete={membrete}
                  resolveLabel={resolveLabel}
                  porGrupo={porGrupo}
                  disabled={disabled}
                  onPersistJson={onAutoDatosExpedienteEditorJsonChange}
                />
              ) : null}
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
                  className="plantilla-inline-editor min-h-[14rem] pt-3 leading-relaxed text-slate-900"
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

function AutoDatosExpedienteBlock({
  membrete,
  resolveLabel,
  porGrupo,
  disabled,
  onPersistJson,
}: {
  membrete: PlantillasMembrete;
  resolveLabel: (key: string) => string;
  porGrupo: Map<GrupoMarcador, ReturnType<typeof marcadoresParaPlantilla>>;
  disabled?: boolean;
  onPersistJson?: (json: string) => void;
}) {
  const extensions = useMemo(() => buildAutoMetaExtensions(resolveLabel), [resolveLabel]);
  const storageValue = useMemo(
    () => membrete.autoDatosExpedienteEditorJson?.trim() || defaultAutoDatosExpedienteDocStorage(),
    [membrete.autoDatosExpedienteEditorJson],
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPersistRef = useRef(onPersistJson);
  onPersistRef.current = onPersistJson;

  const emit = useCallback((json: string) => {
    const fn = onPersistRef.current;
    if (!fn) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fn(json), 450);
  }, []);

  const editable = Boolean(onPersistJson) && !disabled;

  const editor = useEditor(
    {
      extensions,
      content: parseStorageToDoc(storageValue),
      editable,
      onUpdate: ({ editor: ed }) => {
        emit(docToStorage(ed.getJSON()));
      },
    },
    [extensions],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      const cur = docToStorage(editor.getJSON());
      if (cur === storageValue) return;
      editor.commands.setContent(parseStorageToDoc(storageValue), { emitUpdate: false });
    } catch {
      /* noop */
    }
  }, [editor, storageValue]);

  const tb = (active: boolean) =>
    `flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-md px-2 text-xs font-bold transition ${
      active ? 'bg-indigo-100 text-indigo-950' : 'text-slate-600 hover:bg-slate-100'
    } disabled:opacity-40`;

  const insertVar = (clave: string) => {
    if (!clave || !editor) return;
    editor.chain().focus().insertExpedienteVariable(clave).run();
  };

  if (!editor) {
    return (
      <div className="mt-4 rounded-lg border border-slate-200/90 bg-slate-50/40">
        <p className="border-b border-slate-200/80 px-3 py-2 text-[10px] leading-snug text-slate-600">
          <span className="font-semibold text-slate-800">Datos del expediente</span> — cargando editor…
        </p>
        <div className="h-24 animate-pulse bg-white" />
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200/90 bg-slate-50/40">
      <p className="border-b border-slate-200/80 px-3 py-2 text-[10px] leading-snug text-slate-600">
        <span className="font-semibold text-slate-800">Datos del expediente</span> (arriba del cuerpo del auto): cada despacho
        puede cambiar textos y orden. Las pastillas moradas son los mismos datos del expediente que en el texto del escrito
        (pase el cursor para ver el código técnico). Se guardan con el membrete del despacho.
      </p>
      <div className="border-b border-slate-200/80 bg-white px-2 py-1.5">
        <div className="flex min-h-[2.25rem] flex-wrap items-center gap-1">
          <button
            type="button"
            title="Negrita"
            disabled={!editable}
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={tb(editor.isActive('bold'))}
          >
            <span className="font-serif font-bold">N</span>
          </button>
          <button
            type="button"
            title="Cursiva"
            disabled={!editable}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={tb(editor.isActive('italic'))}
          >
            <span className="font-serif italic">K</span>
          </button>
          <button
            type="button"
            title="Subrayado"
            disabled={!editable}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={tb(editor.isActive('underline'))}
          >
            <span className="font-serif underline decoration-2 underline-offset-2">S</span>
          </button>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
          <button
            type="button"
            title="Izquierda"
            disabled={!editable}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={tb(editor.isActive({ textAlign: 'left' }))}
          >
            <AlignLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Centrar"
            disabled={!editable}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={tb(editor.isActive({ textAlign: 'center' }))}
          >
            <AlignCenter className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Justificar"
            disabled={!editable}
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            className={tb(editor.isActive({ textAlign: 'justify' }))}
          >
            <AlignJustify className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
          <MarcadorInsertMenu porGrupo={porGrupo} onInsert={insertVar} disabled={!editable} />
        </div>
      </div>
      <EditorContent
        editor={editor}
        className="auto-meta-rich-editor px-3 py-2.5 text-[13px] text-slate-900 [&_.ProseMirror]:min-h-[6rem] [&_.ProseMirror]:outline-none"
      />
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
  pageLayout,
  onPageLayoutChange,
  onInsert,
  onCancel,
  onSave,
}: {
  editor: Editor | null;
  disabled?: boolean;
  saving?: boolean;
  porGrupo: Map<GrupoMarcador, ReturnType<typeof marcadoresParaPlantilla>>;
  toggleDefs: DocumentTemplateToggleDef[];
  pageLayout: DocumentTemplatePageLayout;
  onPageLayoutChange: (next: DocumentTemplatePageLayout) => void;
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

      <PageTypographyBar layout={pageLayout} onChange={onPageLayoutChange} disabled={disabled} />

      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

      <MarginsWordMenu layout={pageLayout} onChange={onPageLayoutChange} disabled={disabled} />

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
