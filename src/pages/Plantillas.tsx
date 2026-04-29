import React, { useCallback, useEffect, useState } from 'react';
import {
  FileStack,
  Shield,
  ImagePlus,
  Trash2,
  RotateCcw,
  Plus,
  Briefcase,
  Users,
  Scale,
  Pencil,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { parseUserRole } from '../lib/user-roles';
import type {
  DocumentTemplate,
  DocumentTemplateCategoria as PlantillaCategoria,
  DocumentTemplateTipo as PlantillaTipo,
  DocumentTemplateToggleDef,
  UserRole,
} from '../types';
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
import { TemplateBodyEditor } from '../components/plantillas/TemplateBodyEditor';
import { PlantillaInlineEditor } from '../components/plantillas/PlantillaInlineEditor';
import {
  defaultPlantillasV2,
  loadPlantillas,
  readImageFileAsDataUrl,
  savePlantillas,
  type PlantillasStateV2,
} from '../lib/plantillas-store';
import { defaultToggleDefsForPlantilla } from '../lib/plantilla-template-default-toggles';
import { userFacingSupabaseError } from '../lib/supabase-user-error';

const TIPO_LABEL: Record<PlantillaTipo, string> = {
  informe_ingreso: 'Informe ingreso',
  auto_admisorio: 'Auto admisorio',
  libre: 'Libre / otro',
};

export default function Plantillas() {
  const [data, setData] = useState<PlantillasStateV2>(() => loadPlantillas());
  const [role, setRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [courtId, setCourtId] = useState('court-1');
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const [nuevaCategoria, setNuevaCategoria] = useState<PlantillaCategoria>('secretaria');
  const [nuevaTipo, setNuevaTipo] = useState<PlantillaTipo>('libre');
  const [nuevaNombre, setNuevaNombre] = useState('');
  const [nuevaDesc, setNuevaDesc] = useState('');
  const [nuevaContenidoBase, setNuevaContenidoBase] = useState('');
  const [brandingError, setBrandingError] = useState<string | null>(null);
  /** Plantilla del catálogo con el acordeón de edición abierto (solo una a la vez). */
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState('');
  const [editorToggleDefs, setEditorToggleDefs] = useState<DocumentTemplateToggleDef[]>([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorSuccess, setEditorSuccess] = useState<string | null>(null);

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
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) {
          setRoleReady(true);
          return;
        }
        const { data: row } = await supabase
          .from('profiles')
          .select('role, court_id')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        setRole(parseUserRole((row as { role?: string } | null)?.role));
        const cid = String((row as { court_id?: string })?.court_id ?? 'court-1');
        setCourtId(cid);
        try {
          const remoteMembrete = await fetchCourtBranding(cid);
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
          const list = await fetchDocumentTemplates(cid);
          if (!cancelled) setTemplates(list);
        } catch (e) {
          if (!cancelled) {
            setTemplates([]);
            setTemplatesError(userFacingSupabaseError(e));
          }
        }
      } catch {
        if (!cancelled) setRole('admin');
      } finally {
        if (!cancelled) setRoleReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = role === 'admin';

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageError(null);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      persistMembrete({
        ...data,
        membrete: { ...data.membrete, membreteImageDataUrl: dataUrl },
      });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'No se pudo cargar la imagen.');
    }
  };

  const clearImage = () => {
    setImageError(null);
    persistMembrete({ ...data, membrete: { ...data.membrete, membreteImageDataUrl: '' } });
  };

  const resetDefaults = () => {
    setImageError(null);
    const d = defaultPlantillasV2();
    persistMembrete(d);
  };

  const refreshTemplates = useCallback(async () => {
    try {
      setTemplatesError(null);
      const list = await fetchDocumentTemplates(courtId);
      setTemplates(list);
    } catch (e) {
      setTemplatesError(userFacingSupabaseError(e));
    }
  }, [courtId]);

  const abrirEditorPlantilla = useCallback(
    (p: DocumentTemplate) => {
      if (expandedTemplateId === p.id) {
        setExpandedTemplateId(null);
        setEditorSuccess(null);
        return;
      }
      setExpandedTemplateId(p.id);
      setEditorSuccess(null);
      setEditorDraft(contenidoParaEditorPlantillas(p.contenidoBase, p.tipo, data));
      setEditorToggleDefs(defaultToggleDefsForPlantilla(p.tipo, p.toggleDefs));
    },
    [data, expandedTemplateId],
  );

  const cerrarEditorPlantilla = useCallback(() => {
    setExpandedTemplateId(null);
    setEditorSuccess(null);
    setEditorToggleDefs([]);
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

  const agregarPlantilla = async (e: React.FormEvent) => {
    e.preventDefault();
    const nombre = nuevaNombre.trim();
    if (!nombre) return;
    setTemplatesBusy(true);
    setTemplatesError(null);
    try {
      await insertDocumentTemplate({
        courtId,
        categoria: nuevaCategoria,
        nombre,
        tipo: nuevaTipo,
        descripcion: nuevaDesc.trim() || undefined,
        contenidoBase: nuevaContenidoBase.trim() ? nuevaContenidoBase.trim() : null,
      });
      setNuevaNombre('');
      setNuevaDesc('');
      setNuevaContenidoBase('');
      await refreshTemplates();
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
      await refreshTemplates();
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
          pestaña <strong className="font-semibold text-slate-700">Despacho</strong> del detalle del caso (informe primero,
          luego auto).
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
                    <li
                      key={p.id}
                      className={`rounded-lg border border-slate-100 bg-slate-50/80 ${
                        expandedTemplateId === p.id ? 'ring-1 ring-accent/25' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{p.nombre}</p>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{TIPO_LABEL[p.tipo]}</p>
                          {p.descripcion ? <p className="mt-1 text-xs text-slate-600">{p.descripcion}</p> : null}
                          {p.docxStoragePath ? (
                            <p className="mt-1 text-[10px] text-slate-400">Plantilla Word en Storage</p>
                          ) : p.contenidoBase?.trim() ? (
                            <p className="mt-1 text-[10px] font-semibold text-emerald-700">Texto propio del despacho</p>
                          ) : (
                            <p className="mt-1 text-[10px] text-slate-400">
                              Modelo estándar (pulse el lápiz para revisarlo o cambiarlo y guardar)
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            disabled={templatesBusy}
                            onClick={() => abrirEditorPlantilla(p)}
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
                            onClick={() => void quitarPlantilla(p.id)}
                            className="rounded-md border border-red-100 bg-red-50 p-1.5 text-red-700 hover:bg-red-100 disabled:opacity-40"
                            title="Quitar del catálogo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
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
                              onCancel={cerrarEditorPlantilla}
                              onSave={(valueFromEditor) => void guardarEditorPlantilla(valueFromEditor)}
                              showDefaultModelHint={
                                Boolean(p.tipo && !p.contenidoBase?.trim() && cuerpoPredeterminadoPlantilla(p.tipo, data))
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                {templates.filter((c) => c.categoria === 'secretaria').length === 0 ? (
                  <p className="text-xs text-slate-400">Ninguna plantilla en secretaría.</p>
                ) : null}
              </ul>
            </div>
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Scale className="h-4 w-4 text-slate-500" /> Despacho
              </p>
              <ul className="space-y-2">
                {templates
                  .filter((c) => c.categoria === 'despacho')
                  .map((p) => (
                    <li
                      key={p.id}
                      className={`rounded-lg border border-slate-100 bg-slate-50/80 ${
                        expandedTemplateId === p.id ? 'ring-1 ring-accent/25' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{p.nombre}</p>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{TIPO_LABEL[p.tipo]}</p>
                          {p.descripcion ? <p className="mt-1 text-xs text-slate-600">{p.descripcion}</p> : null}
                          {p.docxStoragePath ? (
                            <p className="mt-1 text-[10px] text-slate-400">Plantilla Word en Storage</p>
                          ) : p.contenidoBase?.trim() ? (
                            <p className="mt-1 text-[10px] font-semibold text-emerald-700">Texto propio del despacho</p>
                          ) : (
                            <p className="mt-1 text-[10px] text-slate-400">
                              Modelo estándar (pulse el lápiz para revisarlo o cambiarlo y guardar)
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            disabled={templatesBusy}
                            onClick={() => abrirEditorPlantilla(p)}
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
                            onClick={() => void quitarPlantilla(p.id)}
                            className="rounded-md border border-red-100 bg-red-50 p-1.5 text-red-700 hover:bg-red-100 disabled:opacity-40"
                            title="Quitar del catálogo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
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
                              onCancel={cerrarEditorPlantilla}
                              onSave={(valueFromEditor) => void guardarEditorPlantilla(valueFromEditor)}
                              showDefaultModelHint={
                                Boolean(p.tipo && !p.contenidoBase?.trim() && cuerpoPredeterminadoPlantilla(p.tipo, data))
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                {templates.filter((c) => c.categoria === 'despacho').length === 0 ? (
                  <p className="text-xs text-slate-400">Ninguna plantilla en despacho.</p>
                ) : null}
              </ul>
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
          <form
            onSubmit={(e) => void agregarPlantilla(e)}
            className="border-t border-slate-100 bg-slate-50/40 px-6 py-5"
          >
            <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <Plus className="h-4 w-4" /> Nueva entrada en el catálogo
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="block min-w-[140px] flex-1 space-y-1">
                <span className="text-[11px] font-semibold text-slate-600">Área</span>
                <select
                  value={nuevaCategoria}
                  onChange={(e) => setNuevaCategoria(e.target.value as PlantillaCategoria)}
                  className="input-modern text-sm"
                >
                  <option value="secretaria">Secretaría</option>
                  <option value="despacho">Despacho</option>
                </select>
              </label>
              <label className="block min-w-[160px] flex-1 space-y-1">
                <span className="text-[11px] font-semibold text-slate-600">Tipo</span>
                <select
                  value={nuevaTipo}
                  onChange={(e) => setNuevaTipo(e.target.value as PlantillaTipo)}
                  className="input-modern text-sm"
                >
                  <option value="informe_ingreso">Informe de ingreso</option>
                  <option value="auto_admisorio">Auto admisorio</option>
                  <option value="libre">Libre / otro</option>
                </select>
              </label>
              <label className="block min-w-[200px] flex-[2] space-y-1">
                <span className="text-[11px] font-semibold text-slate-600">Nombre visible</span>
                <input
                  value={nuevaNombre}
                  onChange={(e) => setNuevaNombre(e.target.value)}
                  placeholder="Ej. Informe de archivo"
                  className="input-modern text-sm"
                />
              </label>
              <label className="block min-w-[200px] flex-[2] space-y-1">
                <span className="text-[11px] font-semibold text-slate-600">Descripción (opcional)</span>
                <input
                  value={nuevaDesc}
                  onChange={(e) => setNuevaDesc(e.target.value)}
                  placeholder="Uso interno"
                  className="input-modern text-sm"
                />
              </label>
              <div className="w-full sm:col-span-2">
                <TemplateBodyEditor
                  templateTipo={nuevaTipo}
                  label="Texto del documento (opcional)"
                  placeholder={'Puede escribir párrafos normales y usar el menú superior para insertar datos del expediente.'}
                  value={nuevaContenidoBase}
                  onChange={setNuevaContenidoBase}
                  minRows={8}
                />
                <p className="mt-2 text-[10px] text-slate-500">
                  Si deja el cuerpo vacío, el expediente usará el borrador por defecto del sistema.
                </p>
              </div>
              <button
                type="submit"
                disabled={templatesBusy}
                className="btn-primary shrink-0 px-5 py-3 text-xs uppercase tracking-wider disabled:opacity-40"
              >
                {templatesBusy ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Panel administrador */}
      {roleReady && isAdmin && (
        <section className="card-modern overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200/90 bg-gradient-to-br from-slate-50/95 via-white to-slate-50/40 px-6 py-4">
            <Shield className="h-5 w-5 text-accent" />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Gestionar membrete y textos fijos</h2>
              <p className="text-[11px] text-slate-500">
                Solo administrador. Lo que guarde aquí lo verán secretaría y despacho en todos los equipos; además se guarda una
                copia en este navegador por si trabaja sin conexión.
              </p>
            </div>
          </div>
          {brandingError ? (
            <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-xs font-medium text-red-800">{brandingError}</div>
          ) : null}
          <div className="grid gap-8 p-6 md:grid-cols-2">
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Encabezado judicial (tres líneas)</p>
              {(['line1', 'line2', 'line3'] as const).map((k) => (
                <label key={k} className="block space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">
                    Línea {k === 'line1' ? '1' : k === 'line2' ? '2' : '3'}
                  </span>
                  <input
                    type="text"
                    value={data.membrete.auto[k]}
                    onChange={(e) =>
                      persistMembrete({
                        ...data,
                        membrete: {
                          ...data.membrete,
                          auto: { ...data.membrete.auto, [k]: e.target.value },
                        },
                      })
                    }
                    className="input-modern text-sm"
                  />
                </label>
              ))}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nombre completo del juzgado (informe)</p>
                <textarea
                  value={data.membrete.informe.juzgado}
                  onChange={(e) =>
                    persistMembrete({
                      ...data,
                      membrete: {
                        ...data.membrete,
                        informe: { ...data.membrete.informe, juzgado: e.target.value },
                      },
                    })
                  }
                  rows={2}
                  className="input-modern min-h-[3rem] resize-y text-sm"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dirección</p>
                <textarea
                  value={data.membrete.informe.direccion}
                  onChange={(e) =>
                    persistMembrete({
                      ...data,
                      membrete: {
                        ...data.membrete,
                        informe: { ...data.membrete.informe, direccion: e.target.value },
                      },
                    })
                  }
                  rows={2}
                  className="input-modern min-h-[3rem] resize-y text-sm"
                />
              </div>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-600">Correo institucional</span>
                <input
                  type="email"
                  value={data.membrete.informe.correo}
                  onChange={(e) =>
                    persistMembrete({
                      ...data,
                      membrete: {
                        ...data.membrete,
                        informe: { ...data.membrete.informe, correo: e.target.value },
                      },
                    })
                  }
                  className="input-modern text-sm"
                />
              </label>
            </div>

            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Imagen de membrete (logo / escudo)</p>
              <p className="text-xs text-slate-500">
                PNG o JPEG, máximo ~1,2 MB. Se muestra en el informe y puede sustituir el ícono genérico en las vistas
                esquemáticas cuando aplique.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-accent/40 hover:bg-slate-50">
                  <ImagePlus className="h-4 w-4 text-accent" />
                  Subir imagen
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImage} />
                </label>
                {data.membrete.membreteImageDataUrl ? (
                  <button
                    type="button"
                    onClick={clearImage}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    Quitar imagen
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={resetDefaults}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restaurar textos por defecto
                </button>
              </div>
              {imageError ? <p className="text-xs font-medium text-red-600">{imageError}</p> : null}
              {data.membrete.membreteImageDataUrl ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-2 text-[10px] font-bold uppercase text-slate-400">Vista previa</p>
                  <img
                    src={data.membrete.membreteImageDataUrl}
                    alt="Vista previa membrete"
                    className="max-h-32 w-auto max-w-full object-contain"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {roleReady && !isAdmin && (
        <p className="text-center text-xs text-slate-400">
          Para editar membrete e imagen necesita perfil de administrador.
        </p>
      )}

      <footer className="card-modern flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs text-slate-500">
          El membrete y el escudo quedan guardados para todo el despacho. Las plantillas se descargan en Word desde la pestaña
          Despacho de cada expediente. Una copia de respaldo se guarda también en este navegador.
        </p>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Servidor + respaldo local
        </span>
      </footer>
    </div>
  );
}
