import React, { useState } from 'react';
import { Loader2, Pencil, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatRadicado } from '../../lib/formatters';
import { normalizeRadicadoDigits } from '../../lib/radicado-cui';
import { updateCaseRadicado } from '../../lib/update-case-radicado';
import { canEditCaseRadicado } from '../../lib/role-capabilities';
import type { UserRole } from '../../types';

type Props = {
  caseId: string;
  courtId: string;
  radicado: string;
  role: UserRole | null | undefined;
  onUpdated: () => void | Promise<void>;
};

export function CaseRadicadoEditControl({ caseId, courtId, radicado, role, onUpdated }: Props) {
  const canEdit = canEditCaseRadicado(role);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatRadicado(normalizeRadicadoDigits(radicado)));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openEdit = () => {
    setDraft(formatRadicado(normalizeRadicadoDigits(radicado)));
    setErr(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setErr(null);
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await updateCaseRadicado(supabase, {
        caseId,
        courtId,
        previousRadicado: radicado,
        nextRaw: draft,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setEditing(false);
      await onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo actualizar el radicado.');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
        Expediente {formatRadicado(normalizeRadicadoDigits(radicado) || radicado)}
      </h1>
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Expediente {formatRadicado(normalizeRadicadoDigits(radicado) || radicado)}
        </h1>
        <button
          type="button"
          onClick={openEdit}
          title="Corregir radicado (23 dígitos)"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 shadow-sm hover:border-slate-300 hover:text-slate-800"
        >
          <Pencil className="h-3 w-3" />
          Editar
        </button>
      </div>
    );
  }

  const digits = normalizeRadicadoDigits(draft);
  const digitCount = digits.length;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Corregir radicado (CUI)</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input-modern min-w-[16rem] flex-1 font-mono text-sm tabular-nums sm:min-w-[22rem]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="11001-31-03-051-2026-00362-00"
          inputMode="numeric"
          autoFocus
          disabled={saving}
          aria-label="Radicado de 23 dígitos"
        />
        <button
          type="button"
          disabled={saving || digitCount !== 23}
          onClick={() => void save()}
          className="rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={cancel}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-bold uppercase text-slate-600 hover:bg-slate-50"
        >
          <X className="h-3 w-3" />
          Cancelar
        </button>
      </div>
      <p className={`text-[10px] font-medium ${digitCount === 23 ? 'text-emerald-700' : 'text-slate-500'}`}>
        {digitCount}/23 dígitos
        {digitCount === 23 ? ` · ${formatRadicado(digits)}` : ''}
      </p>
      {err ? <p className="text-xs font-medium text-rose-700">{err}</p> : null}
    </div>
  );
}
