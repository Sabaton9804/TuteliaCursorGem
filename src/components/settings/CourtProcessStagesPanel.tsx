import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Plus, RotateCcw, Save } from 'lucide-react';
import { useCourtOperational } from '../../contexts/CourtOperationalContext';
import type { CourtStageEditorItem } from '../../lib/court-process-stages-service';
import {
  ensureCourtProcessStagesSeeded,
  replaceCourtProcessStages,
  restoreCourtProcessStagesFromTemplate,
  slugCustomStageCode,
} from '../../lib/court-process-stages-service';

const LINEAR_LIMIT_NOTICE =
  'El carril editable es lineal (una etapa abierta por expediente). No modela pistas paralelas, incidentes concurrentes ni mutación de tipo o sub-trámite a mitad del proceso. Eso queda para una fase posterior.';

function rowsToEditor(items: { id: string; stage_code: string; label: string; order_index: number; is_hidden: boolean; is_custom: boolean; source_stage_definition_id: string | null; responsible_role: CourtStageEditorItem['responsible_role']; term_days: number | null; term_type: CourtStageEditorItem['term_type'] }[]): CourtStageEditorItem[] {
  return [...items]
    .sort((a, b) => a.order_index - b.order_index)
    .map((r, i) => ({
      id: r.id,
      stage_code: r.stage_code,
      label: r.label,
      order_index: i,
      is_hidden: r.is_hidden,
      is_custom: r.is_custom,
      source_stage_definition_id: r.source_stage_definition_id,
      responsible_role: r.responsible_role,
      term_days: r.term_days,
      term_type: r.term_type,
    }));
}

export function CourtProcessStagesPanel() {
  const { courtId, processDefinitions, refresh, loading: opsLoading } = useCourtOperational();
  const defs = useMemo(
    () => [...processDefinitions].sort((a, b) => a.label.localeCompare(b.label, 'es')),
    [processDefinitions],
  );

  const [defId, setDefId] = useState('');
  const [items, setItems] = useState<CourtStageEditorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');

  const selected = defs.find((d) => d.id === defId) ?? null;

  useEffect(() => {
    if (!defId && defs[0]?.id) setDefId(defs[0].id);
  }, [defs, defId]);

  const loadEditor = useCallback(async () => {
    if (!defId || !selected) {
      setItems([]);
      return;
    }
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const rows = await ensureCourtProcessStagesSeeded(
        courtId,
        defId,
        selected.templateStages.length ? selected.templateStages : selected.stages,
      );
      setItems(rowsToEditor(rows));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo cargar el carril.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [courtId, defId, selected]);

  useEffect(() => {
    void loadEditor();
  }, [loadEditor]);

  const move = (index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[index]!;
      next[index] = next[j]!;
      next[j] = tmp;
      return next.map((r, i) => ({ ...r, order_index: i }));
    });
  };

  const addCustom = () => {
    const label = newLabel.trim();
    if (!label) return;
    let code = slugCustomStageCode(label);
    const used = new Set(items.map((i) => i.stage_code));
    if (used.has(code)) {
      let n = 2;
      while (used.has(`${code}_${n}`)) n += 1;
      code = `${code}_${n}`;
    }
    setItems((prev) => [
      ...prev,
      {
        id: `temp-${code}`,
        stage_code: code,
        label,
        order_index: prev.length,
        is_hidden: false,
        is_custom: true,
        source_stage_definition_id: null,
        responsible_role: 'secretaria',
        term_days: null,
        term_type: 'none',
      },
    ]);
    setNewLabel('');
  };

  const removeCustom = (index: number) => {
    const row = items[index];
    if (!row?.is_custom) return;
    if (!window.confirm(`¿Eliminar la etapa propia «${row.label}»?`)) return;
    setItems((prev) => prev.filter((_, i) => i !== index).map((r, i) => ({ ...r, order_index: i })));
  };

  const save = async () => {
    if (!defId) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const saved = await replaceCourtProcessStages(courtId, defId, items);
      setItems(rowsToEditor(saved));
      await refresh();
      setStatus('Carril guardado. Los expedientes usarán estos nombres y orden.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (!defId || !selected) return;
    if (
      !window.confirm(
        '¿Restaurar la plantilla Tutelia para este proceso? Se perderán renombres, orden, ocultas y etapas propias.',
      )
    )
      return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const plantilla = selected.templateStages.length ? selected.templateStages : selected.stages;
      const rows = await restoreCourtProcessStagesFromTemplate(courtId, defId, plantilla);
      setItems(rowsToEditor(rows));
      await refresh();
      setStatus('Plantilla Tutelia restaurada.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo restaurar.');
    } finally {
      setSaving(false);
    }
  };

  if (opsLoading && !defs.length) {
    return (
      <p className="text-xs text-slate-400 flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando procesos del despacho…
      </p>
    );
  }

  if (!defs.length) {
    return (
      <p className="text-sm text-slate-500">
        No hay tipos de proceso habilitados para este juzgado. Contacte a plataforma o revise el catálogo.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-xs leading-relaxed text-amber-950">
        {LINEAR_LIMIT_NOTICE}
      </p>

      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400" htmlFor="cps-process">
        Tipo de proceso
      </label>
      <select
        id="cps-process"
        className="input-modern w-full max-w-xl text-sm font-medium"
        value={defId}
        onChange={(e) => setDefId(e.target.value)}
      >
        {defs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
            {d.legacy_case_type ? ` (${d.legacy_case_type})` : ''}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando etapas…
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {items.map((row, index) => (
            <li
              key={row.id || row.stage_code}
              className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${row.is_hidden ? 'bg-slate-50 opacity-70' : ''}`}
            >
              <span className="w-7 shrink-0 text-center font-mono text-[10px] text-slate-400">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <input
                  className="input-modern min-w-0 flex-1 text-sm"
                  value={row.label}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)),
                    )
                  }
                  aria-label={`Nombre etapa ${row.stage_code}`}
                />
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{row.stage_code}</span>
                {row.is_custom ? (
                  <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-800">
                    Propia
                  </span>
                ) : null}
              </div>
              <select
                className="input-modern w-[7.5rem] text-[11px]"
                value={row.responsible_role ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setItems((prev) =>
                    prev.map((r, i) =>
                      i === index
                        ? {
                            ...r,
                            responsible_role: v === 'despacho' || v === 'secretaria' ? v : null,
                          }
                        : r,
                    ),
                  );
                }}
              >
                <option value="">Rol —</option>
                <option value="secretaria">Secretaría</option>
                <option value="despacho">Despacho</option>
              </select>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                  title="Subir"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                  title="Bajar"
                  disabled={index >= items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                  title={row.is_hidden ? 'Mostrar en carril' : 'Ocultar del carril'}
                  onClick={() =>
                    setItems((prev) =>
                      prev.map((r, i) => (i === index ? { ...r, is_hidden: !r.is_hidden } : r)),
                    )
                  }
                >
                  {row.is_hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                {row.is_custom ? (
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[10px] font-bold uppercase text-rose-700 hover:bg-rose-50"
                    onClick={() => removeCustom(index)}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Añadir etapa propia (sin automatismo)
          <input
            className="input-modern mt-1 w-full text-sm font-medium normal-case tracking-normal"
            placeholder="Ej. Revisión oficial mayor"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={addCustom}
          disabled={!newLabel.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Añadir
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void save()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Guardar carril
        </button>
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void restore()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restaurar plantilla
        </button>
      </div>

      {status ? <p className="text-xs font-medium text-emerald-700">{status}</p> : null}
      {err ? <p className="text-xs font-medium text-rose-700">{err}</p> : null}
    </div>
  );
}
