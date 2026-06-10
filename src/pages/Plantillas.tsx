import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileStack, Trash2, Plus, Briefcase, Users, Scale, Pencil, Tags } from 'lucide-react';
import { useSessionCourt } from '../contexts/SessionCourtContext';
import type {
  DocumentTemplate,
  DocumentTemplateCategoria as PlantillaCategoria,
  DocumentTemplatePageLayout,
  DocumentTemplateTipo as PlantillaTipo,
  DocumentTemplateToggleDef,
  UserRole,
} from '../types';
import { mergePageLayout } from '../lib/document-template-page-layout';
import {
  deleteDocumentTemplate,
  fetchDocumentTemplates,
  insertDocumentTemplate,
  updateDocumentTemplate,
} from '../lib/document-templates';
import { describeBrandingSaveError, fetchCourtBranding, saveCourtBranding } from '../lib/court-branding';
import {
  contenidoParaEditorPlantillas,
  cuerpoPredeterminadoPlantilla,
} from '../lib/plantilla-variables';
import { PlantillaInlineEditor } from '../components/plantillas/PlantillaInlineEditor';
import { MembreteBrandingPanel } from '../components/plantillas/MembreteBrandingPanel';
import {
  defaultPlantillasV2,
  loadPlantillas,
  savePlantillas,
  type PlantillasStateV2,
} from '../lib/plantillas-store';
import { defaultToggleDefsForPlantilla } from '../lib/plantilla-template-default-toggles';
import { userFacingSupabaseError } from '../lib/supabase-user-error';

const TIPO_LABEL: Record<PlantillaTipo, string> = {
  informe_ingreso: 'Informe ingreso',
  auto_admisorio: 'Auto admisorio',
  notificacion_admisorio: 'Notificación auto',
  notificacion_fallo: 'Notificación fallo',
  libre: 'Libre / otro',
};

const OPCIONES_NUEVA_PLANTILLA: { categoria: PlantillaCategoria; tipo: PlantillaTipo }[] = [
  { categoria: 'secretaria', tipo: 'informe_ingreso' },
  { categoria: 'secretaria', tipo: 'notificacion_admisorio' },
  { categoria: 'secretaria', tipo: 'notificacion_fallo' },
  { categoria: 'secretaria', tipo: 'libre' },
  { categoria: 'despacho', tipo: 'auto_admisorio' },
  { categoria: 'despacho', tipo: 'libre' },
];

function opcionesNuevaPorCategoria(cat: PlantillaCategoria) {
  return OPCIONES_NUEVA_PLANTILLA.filter((o) => o.categoria === cat);
}

type CatalogTemplateListItemProps = {
  p: DocumentTemplate;
  tipoLabel: string;
  expandedTemplateId: string | null;
  metaEditingId: string | null;
  metaNombre: string;
  metaDesc: string;
  templatesBusy: boolean;
  onMetaNombreChange: (v: string) => void;
  onMetaDescChange: (v: string) => void;
  onToggleMetaEdit: (p: DocumentTemplate) => void;
  onCancelMetaEdit: () => void;
  onSaveMeta: (id: string) => void | Promise<void>;
  onAbrirEditor: (p: DocumentTemplate) => void;
  onQuitar: (id: string) => void;
  children?: React.ReactNode;
};

function CatalogTemplateListItem({
  p,
  tipoLabel,
  expandedTemplateId,
  metaEditingId,
  metaNombre,
  metaDesc,
  templatesBusy,
  onMetaNombreChange,
  onMetaDescChange,
  onToggleMetaEdit,
  onCancelMetaEdit,
  onSaveMeta,
  onAbrirEditor,
  onQuitar,
  children,
}: CatalogTemplateListItemProps) {
  const editingMeta = metaEditingId === p.id;
  return (
    <li
      className={`rounded-lg border border-slate-100 bg-slate-50/80 ${
        expandedTemplateId === p.id ? 'ring-1 ring-accent/25' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {editingMeta ? (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Nombre visible</span>
                <input
                  value={metaNombre}
                  onChange={(e) => onMetaNombreChange(e.target.value)}
                  className="input-modern w-full text-sm"
                  placeholder="Ej. Informe de ingreso al despacho"
                  disabled={templatesBusy}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Descripción (uso interno)
                </span>
                <textarea
                  value={metaDesc}
                  onChange={(e) => onMetaDescChange(e.target.value)}
                  rows={2}
                  placeholder="Nota para secretaría o despacho"
                  disabled={templatesBusy}
                  className="input-modern min-h-[2.75rem] w-full resize-y text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={templatesBusy}
                  onClick={() => void onSaveMeta(p.id)}
                  className="btn-primary rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide disabled:opacity-40"
                >
                  Guardar datos
                </button>
                <button
                  type="button"
                  disabled={templatesBusy}
                  onClick={onCancelMetaEdit}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
              <p className="text-[10px] leading-snug text-slate-500">
                El tipo de plantilla (<strong className="font-semibold text-slate-700">{tipoLabel}</strong>) lo usa el
                sistema para el flujo del expediente; aquí solo cambia el nombre y la descripción que ve el equipo.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800">{p.nombre}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{tipoLabel}</p>
              {p.descripcion ? (
                <p className="mt-1 text-xs text-slate-600">{p.descripcion}</p>
              ) : (
                <p className="mt-1 text-[10px] italic text-slate-400">Sin descripción — use «Datos» para añadir una.</p>
              )}
              {p.docxStoragePath ? (
                <p className="mt-1 text-[10px] text-slate-400">Plantilla Word en Storage</p>
              ) : p.contenidoBase?.trim() ? (
                <p className="mt-1 text-[10px] font-semibold text-emerald-700">Texto propio del despacho</p>
              ) : (
                <p className="mt-1 text-[10px] text-slate-400">
                  Modelo estándar (pulse el lápiz para revisarlo o cambiarlo y guardar)
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            disabled={templatesBusy}
            onClick={() => onToggleMetaEdit(p)}
            className={`rounded-md border p-1.5 disabled:opacity-40 ${
              editingMeta ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            title={editingMeta ? 'Cerrar edición de nombre y descripción' : 'Editar nombre y descripción'}
          >
            <Tags className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={templatesBusy}
            onClick={() => onAbrirEditor(p)}
            className={`rounded-md border p-1.5 disabled:opacity-40 ${
              expandedTemplateId === p.id
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            title={expandedTemplateId === p.id ? 'Cerrar editor' : 'Editar texto del documento'}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={templatesBusy}
            onClick={() => void onQuitar(p.id)}
            className="rounded-md border border-red-100 bg-red-50 p-1.5 text-red-700 hover:bg-red-100 disabled:opacity-40"
            title="Quitar del catálogo"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {children}
    </li>
  );
}

export default function Plantillas() {
  const { courtId, profile } = useSessionCourt();
  const role: UserRole | null = profile?.role ?? null;
  const roleReady = profile != null;
  const [data, setData] = useState<PlantillasStateV2>(() => loadPlantillas());
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [catalogPlusOpen, setCatalogPlusOpen] = useState<'secretaria' | 'despacho' | null>(null);
  const secretariaCatalogPlusRef = useRef<HTMLDivElement>(null);
  const despachoCatalogPlusRef = useRef<HTMLDivElement>(null);
  /** Plantilla del catálogo con el acordeón de edición abierto (solo una a la vez). */
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState('');
  const [editorToggleDefs, setEditorToggleDefs] = useState<DocumentTemplateToggleDef[]>([]);
  const [editorPageLayout, setEditorPageLayout] = useState<DocumentTemplatePageLayout>(() => mergePageLayout(null));
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorSuccess, setEditorSuccess] = useState<string | null>(null);
  /** Edición de nombre y descripción del catálogo (icono etiquetas). */
  const [metaEditingId, setMetaEditingId] = useState<string | null>(null);
  const [metaNombre, setMetaNombre] = useState('');
  const [metaDesc, setMetaDesc] = useState('');

  /** Membrete en BD compartido + espejo local para uso offline. */
  const persistMembrete = useCallback((next: PlantillasStateV2) => {
    setData(next);
    savePlantillas(next);
    setBrandingError(null);
    void saveCourtBranding(courtId, next.membrete).catch((e) => {
      setBrandingError(describeBrandingSaveError(e));
    });
  }, [courtId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const remoteMembrete = await fetchCourtBranding(courtId);
        if (!cancelled) {
          const pkg: PlantillasStateV2 = { version: 3, membrete: remoteMembrete };
          setData(pkg);
          savePlantillas(pkg);
        }
      } catch {
        if (!cancelled) {
          const local = loadPlantillas();
          setData(local);
        }
      }
      try {
        const list = await fetchDocumentTemplates(courtId);
        if (!cancelled) setTemplates(list);
      } catch (e) {
        if (!cancelled) {
          setTemplates([]);
          setTemplatesError(userFacingSupabaseError(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courtId]);

  const isAdmin = role === 'admin';

  useEffect(() => {
    if (!catalogPlusOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const ref =
        catalogPlusOpen === 'secretaria' ? secretariaCatalogPlusRef : despachoCatalogPlusRef;
      if (ref.current?.contains(t)) return;
      setCatalogPlusOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [catalogPlusOpen]);

  const resetDefaults = () => {
    const d = defaultPlantillasV2();
    persistMembrete(d);
  };

  const refreshTemplates = useCallback(async (): Promise<DocumentTemplate[]> => {
    try {
      setTemplatesError(null);
      const list = await fetchDocumentTemplates(courtId);
      setTemplates(list);
      return list;
    } catch (e) {
      setTemplatesError(userFacingSupabaseError(e));
      return [];
    }
  }, [courtId]);

  const aplicarPlantillaEnEditor = useCallback((p: DocumentTemplate) => {
    setExpandedTemplateId(p.id);
    setEditorSuccess(null);
    setEditorDraft(contenidoParaEditorPlantillas(p.contenidoBase, p.tipo, data));
    setEditorToggleDefs(defaultToggleDefsForPlantilla(p.tipo, p.toggleDefs));
    setEditorPageLayout(mergePageLayout(p.pageLayout));
  }, [data]);

  const abrirEditorPlantilla = useCallback(
    (p: DocumentTemplate) => {
      if (expandedTemplateId === p.id) {
        setExpandedTemplateId(null);
        setEditorSuccess(null);
        setMetaEditingId(null);
        return;
      }
      if (expandedTemplateId != null && expandedTemplateId !== p.id) {
        setMetaEditingId(null);
      }
      aplicarPlantillaEnEditor(p);
    },
    [aplicarPlantillaEnEditor, expandedTemplateId],
  );

  const cerrarEditorPlantilla = useCallback(() => {
    setExpandedTemplateId(null);
    setEditorSuccess(null);
    setEditorToggleDefs([]);
    setMetaEditingId(null);
  }, []);

  const guardarEditorPlantilla = async (valueFromEditor?: string) => {
    const tpl = templates.find((t) => t.id === expandedTemplateId);
    if (!tpl) return;
    if (tpl.courtId !== courtId) {
      setTemplatesError(
        `No tiene permiso para editar esta plantilla (court_id plantilla: ${tpl.courtId}, court_id sesión: ${courtId}).`,
      );
      return;
    }
    setEditorSaving(true);
    setTemplatesError(null);
    setEditorSuccess(null);
    try {
      const payload = typeof valueFromEditor === 'string' ? valueFromEditor : editorDraft;
      const normalizedPayload = payload.trim() ? payload.trim() : null;
      const updated = await updateDocumentTemplate(tpl.id, {
        contenidoBase: payload.trim() ? payload.trim() : null,
        toggleDefs: editorToggleDefs,
        pageLayout: editorPageLayout,
      });
      if (updated.contenidoBase !== normalizedPayload) {
        throw new Error('Persistencia inconsistente: el valor guardado no coincide con el enviado.');
      }
      if (import.meta.env.DEV) {
        console.info('[plantillas:save-check]', {
          templateId: tpl.id,
          courtIdSesion: courtId,
          courtIdPlantilla: tpl.courtId,
          payloadLength: normalizedPayload?.length ?? 0,
          persistedLength: updated.contenidoBase?.length ?? 0,
          match: updated.contenidoBase === normalizedPayload,
        });
      }
      await refreshTemplates();
      setEditorDraft(payload);
      setEditorSuccess('Cambios guardados correctamente.');
    } catch (err) {
      setTemplatesError(userFacingSupabaseError(err));
    } finally {
      setEditorSaving(false);
    }
  };

  const crearPlantillaDesdeOpcion = async (opt: (typeof OPCIONES_NUEVA_PLANTILLA)[number]) => {
    setCatalogPlusOpen(null);
    setTemplatesBusy(true);
    setTemplatesError(null);
    setEditorSuccess(null);
    try {
      const nombreBase =
        opt.tipo === 'informe_ingreso'
          ? 'Nueva plantilla · informe de ingreso'
          : opt.tipo === 'auto_admisorio'
            ? 'Nueva plantilla · auto admisorio'
            : `Nueva plantilla · ${opt.categoria === 'secretaria' ? 'secretaría' : 'despacho'}`;
      const nuevo = await insertDocumentTemplate({
        courtId,
        categoria: opt.categoria,
        tipo: opt.tipo,
        nombre: nombreBase,
        descripcion: undefined,
        contenidoBase: null,
      });
      const list = await refreshTemplates();
      const fresh = list.find((t) => t.id === nuevo.id) ?? nuevo;
      if (expandedTemplateId != null && expandedTemplateId !== fresh.id) {
        setMetaEditingId(null);
      }
      aplicarPlantillaEnEditor(fresh);
      setMetaEditingId(fresh.id);
      setMetaNombre(fresh.nombre);
      setMetaDesc(fresh.descripcion ?? '');
      setEditorSuccess('Plantilla creada: mismo editor que al editar (nombre, cuerpo, márgenes y letra).');
    } catch (err) {
      setTemplatesError(userFacingSupabaseError(err));
    } finally {
      setTemplatesBusy(false);
    }
  };

  const quitarPlantilla = async (id: string) => {
    setTemplatesBusy(true);
    setTemplatesError(null);
    try {
      await deleteDocumentTemplate(id);
      if (metaEditingId === id) {
        setMetaEditingId(null);
      }
      await refreshTemplates();
    } catch (err) {
      setTemplatesError(userFacingSupabaseError(err));
    } finally {
      setTemplatesBusy(false);
    }
  };

  const toggleMetaEdit = (p: DocumentTemplate) => {
    if (metaEditingId === p.id) {
      setMetaEditingId(null);
      return;
    }
    setMetaEditingId(p.id);
    setMetaNombre(p.nombre);
    setMetaDesc(p.descripcion ?? '');
  };

  const cancelMetaEdit = () => {
    setMetaEditingId(null);
  };

  const guardarMetaPlantilla = async (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl || tpl.courtId !== courtId) {
      setTemplatesError('No se pudo confirmar la plantilla o el despacho no coincide.');
      return;
    }
    const n = metaNombre.trim();
    if (!n) {
      setTemplatesError('El nombre visible no puede estar vacío.');
      return;
    }
    setTemplatesBusy(true);
    setTemplatesError(null);
    setEditorSuccess(null);
    try {
      await updateDocumentTemplate(id, {
        nombre: n,
        descripcion: metaDesc.trim(),
      });
      await refreshTemplates();
      setMetaEditingId(null);
      setEditorSuccess('Nombre y descripción guardados.');
    } catch (err) {
      setTemplatesError(userFacingSupabaseError(err));
    } finally {
      setTemplatesBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,1400px)] space-y-10 px-4 pb-16 sm:px-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          <FileStack className="h-4 w-4 text-accent" />
          Documentos del despacho
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Plantillas</h1>
        <p className="max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
          Modelos con variables <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{'{{ }}'}</code>
          . Catálogo dividido en <strong className="font-semibold text-slate-700">secretaría</strong> y{' '}
          <strong className="font-semibold text-slate-700">despacho</strong>. La generación en cada expediente está en la
          pestaña <strong className="font-semibold text-slate-700">Generar documentos</strong> del detalle del caso (informe
          primero, luego auto).
        </p>
      </header>

      {/* Catálogo por área */}
      {roleReady && isAdmin ? (
        <section className="card-modern">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/90 bg-gradient-to-br from-slate-50/95 via-white to-slate-50/40 px-6 py-4">
            <div className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-accent" />
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Catálogo de plantillas</h2>
                <p className="text-[11px] text-slate-500">
                  Secretaría (trámites e informes) y despacho (autos). Agregue o elimine entradas; el borrador en expediente
                  usa las que coincidan con informe de ingreso y auto admisorio.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-10 p-6">
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Users className="h-4 w-4 text-slate-500" /> Secretaría
              </p>
              <ul className="space-y-2">
                {templates
                  .filter((c) => c.categoria === 'secretaria')
                  .map((p) => (
                    <CatalogTemplateListItem
                      key={p.id}
                      p={p}
                      tipoLabel={TIPO_LABEL[p.tipo]}
                      expandedTemplateId={expandedTemplateId}
                      metaEditingId={metaEditingId}
                      metaNombre={metaNombre}
                      metaDesc={metaDesc}
                      templatesBusy={templatesBusy}
                      onMetaNombreChange={setMetaNombre}
                      onMetaDescChange={setMetaDesc}
                      onToggleMetaEdit={toggleMetaEdit}
                      onCancelMetaEdit={cancelMetaEdit}
                      onSaveMeta={guardarMetaPlantilla}
                      onAbrirEditor={abrirEditorPlantilla}
                      onQuitar={(id) => void quitarPlantilla(id)}
                    >
                      {expandedTemplateId === p.id && isAdmin ? (
                        <div className="border-t border-slate-100 bg-slate-50/50 p-2">
                          <div className="rounded-lg border border-slate-200/90 bg-white shadow-sm">
                            <PlantillaInlineEditor
                              key={p.id}
                              template={p}
                              membrete={data.membrete}
                              value={editorDraft}
                              onChange={setEditorDraft}
                              disabled={editorSaving || templatesBusy}
                              saving={editorSaving}
                              toggleDefs={editorToggleDefs}
                              onToggleDefsChange={setEditorToggleDefs}
                              pageLayout={editorPageLayout}
                              onPageLayoutChange={setEditorPageLayout}
                              onCancel={cerrarEditorPlantilla}
                              onSave={(valueFromEditor) => void guardarEditorPlantilla(valueFromEditor)}
                              showDefaultModelHint={
                                Boolean(p.tipo && !p.contenidoBase?.trim() && cuerpoPredeterminadoPlantilla(p.tipo, data))
                              }
                              onAutoDatosExpedienteEditorJsonChange={
                                p.tipo === 'auto_admisorio'
                                  ? (json) =>
                                      persistMembrete({
                                        version: 3,
                                        membrete: { ...data.membrete, autoDatosExpedienteEditorJson: json },
                                      })
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </CatalogTemplateListItem>
                  ))}
                {templates.filter((c) => c.categoria === 'secretaria').length === 0 ? (
                  <p className="text-xs text-slate-400">Ninguna plantilla en secretaría.</p>
                ) : null}
              </ul>
              <div ref={secretariaCatalogPlusRef} className="relative flex justify-start pt-2">
                <button
                  type="button"
                  disabled={templatesBusy}
                  onClick={() => setCatalogPlusOpen((o) => (o === 'secretaria' ? null : 'secretaria'))}
                  title="Añadir plantilla en secretaría"
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-accent text-white shadow-md transition hover:bg-blue-700 disabled:opacity-40"
                >
                  <Plus className="h-5 w-5" strokeWidth={2.5} />
                </button>
                {catalogPlusOpen === 'secretaria' ? (
                  <div
                    className="absolute left-0 top-full z-20 mt-2 w-[min(calc(100vw-2rem),20rem)] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                    role="menu"
                    aria-label="Nueva plantilla de secretaría"
                  >
                    <p className="border-b border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Nueva plantilla · Secretaría
                    </p>
                    <ul className="max-h-[min(60vh,22rem)] overflow-y-auto py-1">
                      {opcionesNuevaPorCategoria('secretaria').map((opt) => (
                        <li key={`${opt.categoria}-${opt.tipo}`}>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={templatesBusy}
                            onClick={() => void crearPlantillaDesdeOpcion(opt)}
                            className="w-full px-3 py-2.5 text-left text-sm text-slate-800 transition hover:bg-slate-50 disabled:opacity-40"
                          >
                            {TIPO_LABEL[opt.tipo]}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Scale className="h-4 w-4 text-slate-500" /> Despacho
              </p>
              <ul className="space-y-2">
                {templates
                  .filter((c) => c.categoria === 'despacho')
                  .map((p) => (
                    <CatalogTemplateListItem
                      key={p.id}
                      p={p}
                      tipoLabel={TIPO_LABEL[p.tipo]}
                      expandedTemplateId={expandedTemplateId}
                      metaEditingId={metaEditingId}
                      metaNombre={metaNombre}
                      metaDesc={metaDesc}
                      templatesBusy={templatesBusy}
                      onMetaNombreChange={setMetaNombre}
                      onMetaDescChange={setMetaDesc}
                      onToggleMetaEdit={toggleMetaEdit}
                      onCancelMetaEdit={cancelMetaEdit}
                      onSaveMeta={guardarMetaPlantilla}
                      onAbrirEditor={abrirEditorPlantilla}
                      onQuitar={(id) => void quitarPlantilla(id)}
                    >
                      {expandedTemplateId === p.id && isAdmin ? (
                        <div className="border-t border-slate-100 bg-slate-50/50 p-2">
                          <div className="rounded-lg border border-slate-200/90 bg-white shadow-sm">
                            <PlantillaInlineEditor
                              key={p.id}
                              template={p}
                              membrete={data.membrete}
                              value={editorDraft}
                              onChange={setEditorDraft}
                              disabled={editorSaving || templatesBusy}
                              saving={editorSaving}
                              toggleDefs={editorToggleDefs}
                              onToggleDefsChange={setEditorToggleDefs}
                              pageLayout={editorPageLayout}
                              onPageLayoutChange={setEditorPageLayout}
                              onCancel={cerrarEditorPlantilla}
                              onSave={(valueFromEditor) => void guardarEditorPlantilla(valueFromEditor)}
                              showDefaultModelHint={
                                Boolean(p.tipo && !p.contenidoBase?.trim() && cuerpoPredeterminadoPlantilla(p.tipo, data))
                              }
                              onAutoDatosExpedienteEditorJsonChange={
                                p.tipo === 'auto_admisorio'
                                  ? (json) =>
                                      persistMembrete({
                                        version: 3,
                                        membrete: { ...data.membrete, autoDatosExpedienteEditorJson: json },
                                      })
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </CatalogTemplateListItem>
                  ))}
                {templates.filter((c) => c.categoria === 'despacho').length === 0 ? (
                  <p className="text-xs text-slate-400">Ninguna plantilla en despacho.</p>
                ) : null}
              </ul>
              <div ref={despachoCatalogPlusRef} className="relative flex justify-start pt-2">
                <button
                  type="button"
                  disabled={templatesBusy}
                  onClick={() => setCatalogPlusOpen((o) => (o === 'despacho' ? null : 'despacho'))}
                  title="Añadir plantilla en despacho"
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-accent text-white shadow-md transition hover:bg-blue-700 disabled:opacity-40"
                >
                  <Plus className="h-5 w-5" strokeWidth={2.5} />
                </button>
                {catalogPlusOpen === 'despacho' ? (
                  <div
                    className="absolute left-0 top-full z-20 mt-2 w-[min(calc(100vw-2rem),20rem)] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                    role="menu"
                    aria-label="Nueva plantilla de despacho"
                  >
                    <p className="border-b border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Nueva plantilla · Despacho
                    </p>
                    <ul className="max-h-[min(60vh,22rem)] overflow-y-auto py-1">
                      {opcionesNuevaPorCategoria('despacho').map((opt) => (
                        <li key={`${opt.categoria}-${opt.tipo}`}>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={templatesBusy}
                            onClick={() => void crearPlantillaDesdeOpcion(opt)}
                            className="w-full px-3 py-2.5 text-left text-sm text-slate-800 transition hover:bg-slate-50 disabled:opacity-40"
                          >
                            {TIPO_LABEL[opt.tipo]}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {templatesError ? (
            <div className="border-t border-red-100 bg-red-50 px-6 py-3 text-xs font-medium leading-relaxed text-red-800 whitespace-pre-line">
              {templatesError}
            </div>
          ) : null}
          {editorSuccess ? (
            <div className="border-t border-emerald-100 bg-emerald-50 px-6 py-3 text-xs font-medium text-emerald-800">
              {editorSuccess}
            </div>
          ) : null}
        </section>
      ) : null}

      {roleReady && isAdmin ? (
        <MembreteBrandingPanel
          data={data}
          persistMembrete={persistMembrete}
          onResetDefaults={resetDefaults}
          brandingError={brandingError}
        />
      ) : null}

      {roleReady && !isAdmin && (
        <p className="text-center text-xs text-slate-400">
          Para editar membrete e imagen necesita perfil de administrador.
        </p>
      )}

      <footer className="card-modern flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs text-slate-500">
          El membrete y el escudo quedan guardados para todo el despacho. Las plantillas se descargan en Word desde la pestaña
          Generar documentos en cada expediente. Una copia de respaldo se guarda también en este navegador.
        </p>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Servidor + respaldo local
        </span>
      </footer>
    </div>
  );
}
