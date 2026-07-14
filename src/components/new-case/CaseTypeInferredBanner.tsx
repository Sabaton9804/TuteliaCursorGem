import React from 'react';
import type { CaseType } from '../../types';
import { CASE_TYPE_CARD_COPY, resolveCaseTypeCardCopy } from '../../hooks/useNewCaseForm';
import { isCivilCaseType, MVP_RADICABLE_CASE_TYPES } from '../../lib/process-product-scope';
import {
  findSierjuTipoByCode,
  SIERJU_CIVIL_1A_ORAL,
  SIERJU_CIVIL_ACTIVE_SECTION,
  type SierjuProcessTipo,
} from '../../lib/sierju-process-tipos';

type Props = {
  caseFlowType: CaseType;
  onChange: (
    next: CaseType,
    meta?: {
      sierjuCode?: string;
      sierjuLabel?: string;
      sierjuSection?: typeof SIERJU_CIVIL_ACTIVE_SECTION;
    },
  ) => void;
  disabled?: boolean;
  sourceNote?: string | null;
  /** Código SIERJU Civil-Oral (p. ej. ejecutivos). */
  sierjuCode?: string | null;
};

const TUTELA_OPTIONS: { value: CaseType; label: string }[] = MVP_RADICABLE_CASE_TYPES.map((k) => ({
  value: k as CaseType,
  label: `${CASE_TYPE_CARD_COPY[k].title} — ${CASE_TYPE_CARD_COPY[k].subtitle}`,
}));

/**
 * Tipo de expediente: tutela (MVP) o tipificación SIERJU Civil-Oral (vigente).
 * Civil-Escrito (legislación anterior) no se ofrece.
 */
export function CaseTypeInferredBanner({
  caseFlowType,
  onChange,
  disabled,
  sourceNote,
  sierjuCode,
}: Props) {
  const copy = resolveCaseTypeCardCopy(caseFlowType);
  const sierjuHit: SierjuProcessTipo | null = isCivilCaseType(caseFlowType)
    ? findSierjuTipoByCode(sierjuCode) ||
      SIERJU_CIVIL_1A_ORAL.find((t) => t.caseType === caseFlowType) ||
      null
    : null;

  const selectValue = isCivilCaseType(caseFlowType)
    ? `sierju:${SIERJU_CIVIL_ACTIVE_SECTION}:${sierjuHit?.code || 'otros_procesos'}`
    : caseFlowType;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">
            Tipo de proceso {isCivilCaseType(caseFlowType) ? '(SIERJU Civil-Oral)' : '(detectado)'}
          </span>
          <p className="text-xs font-semibold text-slate-700">
            <span aria-hidden className="mr-1.5">
              {copy.emoji}
            </span>
            {sierjuHit ? sierjuHit.label : `${copy.title} — ${copy.subtitle}`}
          </p>
          {sourceNote ? (
            <p className="mt-1 text-[11px] font-medium text-slate-500 leading-snug">{sourceNote}</p>
          ) : (
            <p className="mt-1 text-[11px] font-medium text-slate-500 leading-snug">
              {isCivilCaseType(caseFlowType)
                ? 'Filas TIPOS PROCESOS SIERJU — Primera y única instancia Civil-Oral (vigente).'
                : 'Inferido del correo y/o del análisis IA. Corrija solo si es necesario.'}
            </p>
          )}
        </div>
        <label className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Corregir
          <select
            className="mt-1 block w-full min-w-[280px] max-w-[min(100vw-2rem,420px)] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent/30"
            value={selectValue}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('sierju:')) {
                const rest = v.slice('sierju:'.length);
                const parts = rest.split(':');
                const code = parts.length === 2 ? parts[1] : rest;
                const hit = findSierjuTipoByCode(code);
                if (hit)
                  onChange(hit.caseType, {
                    sierjuCode: hit.code,
                    sierjuLabel: hit.label,
                    sierjuSection: SIERJU_CIVIL_ACTIVE_SECTION,
                  });
                return;
              }
              onChange(v as CaseType);
            }}
          >
            <optgroup label="Tutela (clasificar derecho en hoja 8 SIERJU)">
              {TUTELA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="SIERJU — Civil-Oral (vigente)">
              {SIERJU_CIVIL_1A_ORAL.map((t) => (
                <option key={t.code} value={`sierju:${SIERJU_CIVIL_ACTIVE_SECTION}:${t.code}`}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
    </div>
  );
}
