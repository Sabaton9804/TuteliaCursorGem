import React from 'react';
import type { Case } from '../../types';
import {
  catalogSituacionLabel,
  catalogTipoProcesoVisible,
} from '../../lib/case-catalog-metadata';

type Props = {
  caseItem: Case;
};

function Field({ label, value }: { label: string; value?: string | number | null }) {
  const display = value == null || String(value).trim() === '' ? '—' : String(value);
  return (
    <div className="min-w-[140px] flex-1 space-y-0.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800 break-words">{display}</p>
    </div>
  );
}

export function CaseCatalogMetadataPanel({ caseItem }: Props) {
  const meta = caseItem.catalogMetadata;
  if (!meta || Object.keys(meta).length === 0) {
    return (
      <p className="text-[11px] text-slate-400 pb-1">
        Sin metadatos de catálogo. Importe desde plataforma o actualice con Planner.
      </p>
    );
  }

  const ultimoAuto = meta.ultimo_auto_tipo
    ? `${meta.ultimo_auto_tipo}${meta.ultimo_auto_fecha ? ` · ${meta.ultimo_auto_fecha}` : ''}`
    : undefined;

  return (
    <div className="flex w-full min-w-0 flex-wrap items-end gap-4 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
      <Field label="Tipo proceso" value={catalogTipoProcesoVisible(meta, caseItem.subject)} />
      <Field label="Situación" value={catalogSituacionLabel(meta)} />
      <Field label="Ubicación interna" value={meta.ubicacion_interna || caseItem.operationalStatus} />
      <Field label="Encargado" value={meta.encargado_nombre || caseItem.assignedTo} />
      <Field label="Régimen" value={meta.regimen} />
      <Field label="Etapa" value={meta.etapa} />
      <Field label="Último auto" value={ultimoAuto} />
      <Field label="Confianza estado" value={meta.confianza_estado} />
      <Field label="Fuente" value={meta.fuente_estado} />
    </div>
  );
}
