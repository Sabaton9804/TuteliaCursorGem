import React, { useCallback, useMemo, useState } from 'react';
import { FileUp, Loader2, Sparkles, Trash2, Save } from 'lucide-react';
import type { DocumentTemplate } from '../../types';
import {
  clavesMarcadoresValidas,
  descripcionMarcadorPorClave,
} from '../../lib/plantilla-marcadores-catalog';
import { MarcadoresPreview } from './MarcadoresPreview';
import { supabase } from '../../lib/supabase';
import { updateDocumentTemplate } from '../../lib/document-templates';

type Row = { id: string; original: string; marcador: string };

function nuevaFila(original: string, marcador: string): Row {
  return { id: crypto.randomUUID(), original, marcador };
}

function normalizarMarcador(raw: string, permitidas: Set<string>): string {
  const t = raw.trim();
  if (permitidas.has(t)) return t;
  for (const a of permitidas) {
    if (a.toLowerCase() === t.toLowerCase()) return a;
  }
  const c1 = t.replace(/\s+/g, ' ');
  for (const a of permitidas) {
    if (a.replace(/\s+/g, ' ').toLowerCase() === c1.toLowerCase()) return a;
  }
  const first = permitidas.values().next().value;
  return (typeof first === 'string' ? first : t) || t;
}

function simularTextoLocal(texto: string, filas: Row[]): string {
  let s = texto;
  const sorted = [...filas]
    .filter((r) => r.original.trim())
    .sort((a, b) => b.original.length - a.original.length);
  for (const r of sorted) {
    s = s.split(r.original).join(`{{${r.marcador}}}`);
  }
  return s;
}

type Props = {
  template: DocumentTemplate;
  courtId: string;
  disabled?: boolean;
  onGuardado: () => Promise<void>;
};

export function DocxPlantillaImportSection({ template, courtId, disabled, onGuardado }: Props) {
  const claves = useMemo(() => clavesMarcadoresValidas(template.tipo), [template.tipo]);
  const permitidas = useMemo(() => new Set(claves), [claves]);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [textoMuestra, setTextoMuestra] = useState('');
  const [filas, setFilas] = useState<Row[]>([]);
  const [iaBusy, setIaBusy] = useState(false);
  const [aplicarBusy, setAplicarBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const previewSimulado = useMemo(
    () => (textoMuestra ? simularTextoLocal(textoMuestra, filas) : ''),
    [textoMuestra, filas],
  );

  const analizar = useCallback(async () => {
    if (!archivo) {
      setErr('Seleccione un archivo .docx');
      return;
    }
    setErr(null);
    setIaBusy(true);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('tipo', template.tipo);
      const r = await fetch('/api/plantilla-docx/analizar', { method: 'POST', body: fd });
      const j = (await r.json()) as {
        error?: string;
        textoPlanoMuestra?: string;
        suggestions?: Array<{ original: string; marcador: string }>;
      };
      if (!r.ok) throw new Error(j.error || 'Error al analizar');
      setTextoMuestra(j.textoPlanoMuestra ?? '');
      const sug = j.suggestions ?? [];
      setFilas(
        sug.map((s) =>
          nuevaFila(s.original, normalizarMarcador(s.marcador, permitidas)),
        ),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error de red o servidor');
    } finally {
      setIaBusy(false);
    }
  }, [archivo, template.tipo, permitidas]);

  const eliminarFila = (id: string) => setFilas((prev) => prev.filter((x) => x.id !== id));

  const actualizarFila = (id: string, patch: Partial<Pick<Row, 'original' | 'marcador'>>) => {
    setFilas((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.marcador != null) {
          next.marcador = normalizarMarcador(patch.marcador, permitidas);
        }
        return next;
      }),
    );
  };

  const agregarFila = () => {
    const def = claves[0] ?? 'ACCIONANTE';
    setFilas((prev) => [...prev, nuevaFila('', def)]);
  };

  const guardarEnTutelia = useCallback(async () => {
    if (!archivo) {
      setErr('Seleccione el archivo .docx');
      return;
    }
    setErr(null);
    setAplicarBusy(true);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append(
        'mappings',
        JSON.stringify(filas.map((r) => ({ original: r.original, marcador: r.marcador }))),
      );
      const r = await fetch('/api/plantilla-docx/aplicar', { method: 'POST', body: fd });
      const j = (await r.json()) as { error?: string; processedBase64?: string; previewText?: string };
      if (!r.ok || !j.processedBase64) throw new Error(j.error || 'No se pudo generar el documento procesado');
      const bin = Uint8Array.from(atob(j.processedBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const storagePath = `courts/${courtId}/templates/${template.id}/plantilla.docx`;

      if (template.docxStoragePath && template.docxStoragePath !== storagePath) {
        await supabase.storage.from('document-templates').remove([template.docxStoragePath]);
      }

      const { error: upErr } = await supabase.storage.from('document-templates').upload(storagePath, blob, {
        upsert: true,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      if (upErr) throw upErr;

      const contenidoSync =
        j.previewText?.trim() ||
        previewSimulado.trim() ||
        null;

      await updateDocumentTemplate(template.id, {
        docxStoragePath: storagePath,
        docxMapeo: filas.map((x) => ({ original: x.original, marcador: x.marcador })),
        contenidoBase: contenidoSync,
      });
      await onGuardado();
      setArchivo(null);
      setTextoMuestra('');
      setFilas([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setAplicarBusy(false);
    }
  }, [archivo, filas, courtId, template.id, template.docxStoragePath, previewSimulado, onGuardado]);

  const quitarPlantillaWord = useCallback(async () => {
    if (!template.docxStoragePath) return;
    setErr(null);
    setAplicarBusy(true);
    try {
      const { error: rmErr } = await supabase.storage.from('document-templates').remove([template.docxStoragePath]);
      if (rmErr) console.warn('[plantilla-docx] remove storage:', rmErr.message);
      await updateDocumentTemplate(template.id, {
        docxStoragePath: null,
        docxMapeo: null,
      });
      await onGuardado();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo eliminar');
    } finally {
      setAplicarBusy(false);
    }
  }, [template.docxStoragePath, template.id, onGuardado]);

  return (
    <div className="space-y-4 rounded-xl border border-violet-200/80 bg-violet-50/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileUp className="h-4 w-4 text-violet-700" />
        <p className="text-xs font-bold uppercase tracking-wide text-violet-950">
          Plantilla Word real (.docx) con detección IA
        </p>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-700">
        Suba su auto o informe tal como lo usa hoy. La IA propone qué fragmentos son variables; puede corregir los marcadores
        antes de guardar. La generación en expediente rellenará <span className="font-mono text-violet-900">{'{{ }}'}</span>{' '}
        con los datos del caso. Si no guarda un Word aquí, se sigue usando el texto del cuadro superior o el borrador del
        sistema.
      </p>

      {template.docxStoragePath ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[11px] text-emerald-950">
          <span className="font-semibold">Plantilla Word activa</span>
          <span className="font-mono text-[10px] opacity-80">{template.docxStoragePath}</span>
          <button
            type="button"
            disabled={disabled || aplicarBusy}
            onClick={() => void quitarPlantillaWord()}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-bold uppercase text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" />
            Quitar Word
          </button>
        </div>
      ) : null}

      {err ? <p className="text-xs font-medium text-red-600">{err}</p> : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[200px] flex-1 text-[11px] font-semibold text-slate-600">
          Archivo .docx
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={disabled || iaBusy || aplicarBusy}
            onChange={(e) => {
              setErr(null);
              setArchivo(e.target.files?.[0] ?? null);
            }}
            className="mt-1 block w-full text-xs"
          />
        </label>
        <button
          type="button"
          disabled={disabled || !archivo || iaBusy || aplicarBusy}
          onClick={() => void analizar()}
          className="inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-white px-4 py-2 text-[11px] font-bold text-violet-900 shadow-sm hover:bg-violet-50 disabled:opacity-40"
        >
          {iaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Analizar con IA
        </button>
      </div>

      {filas.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase text-slate-500">Campos detectados (revise y ajuste)</p>
          <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
            {filas.map((row) => (
              <div
                key={row.id}
                className="grid gap-2 border-b border-slate-100 pb-2 last:border-0 sm:grid-cols-[1fr_minmax(140px,200px)_auto]"
              >
                <input
                  value={row.original}
                  onChange={(e) => actualizarFila(row.id, { original: e.target.value })}
                  placeholder="Texto original en el documento"
                  className="input-modern text-xs"
                  disabled={disabled || aplicarBusy}
                />
                <select
                  value={row.marcador}
                  onChange={(e) => actualizarFila(row.id, { marcador: e.target.value })}
                  className="input-modern text-xs"
                  disabled={disabled || aplicarBusy}
                >
                  {claves.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={disabled || aplicarBusy}
                  onClick={() => eliminarFila(row.id)}
                  className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                  title="Quitar fila"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <p className="sm:col-span-3 text-[10px] leading-snug text-slate-600">
                  {descripcionMarcadorPorClave(row.marcador)}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled || aplicarBusy}
            onClick={agregarFila}
            className="text-[11px] font-semibold text-accent underline-offset-2 hover:underline"
          >
            + Añadir sustitución manual
          </button>
        </div>
      ) : null}

      {previewSimulado ? (
        <details open className="rounded-lg border border-violet-100 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-slate-700">
            Vista previa (marcadores en violeta)
          </summary>
          <div className="border-t border-violet-50 px-3 pb-3">
            <MarcadoresPreview text={previewSimulado} />
          </div>
        </details>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-violet-100 pt-3">
        <button
          type="button"
          disabled={disabled || !archivo || filas.length === 0 || aplicarBusy}
          onClick={() => void guardarEnTutelia()}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-violet-800 disabled:opacity-40"
        >
          {aplicarBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Aplicar y guardar en Tutelia
        </button>
      </div>
    </div>
  );
}
