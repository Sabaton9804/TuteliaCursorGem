import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { CaseType } from '../../types';
import type { DerechoTuteladoCode } from '../../lib/sierju-case-codes';
import {
  fetchSierjuClassesForCaseType,
  fetchSierjuClassesForProcessDefinition,
  findSierjuClassByDerecho,
  findSierjuClassById,
  type SierjuClassOption,
} from '../../lib/sierju-catalog-service';

type CaseSierjuClassificationProps = {
  courtId: string;
  caseType?: CaseType;
  processDefinitionId?: string | null;
  valueDerechoCode?: DerechoTuteladoCode;
  valueClassId?: string | null;
  disabled?: boolean;
  saving?: boolean;
  label?: string;
  hint?: string;
  id?: string;
  onChange: (next: {
    derechoCode: DerechoTuteladoCode | undefined;
    classId: string | undefined;
    option: SierjuClassOption | undefined;
  }) => void | Promise<void>;
};

export function CaseSierjuClassification({
  courtId,
  caseType,
  processDefinitionId,
  valueDerechoCode,
  valueClassId,
  disabled = false,
  saving = false,
  label = 'Clasificación SIERJU (alimenta el informe global)',
  hint,
  id = 'sierju-classification',
  onChange,
}: CaseSierjuClassificationProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classes, setClasses] = useState<SierjuClassOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const rows =
          processDefinitionId && processDefinitionId.trim()
            ? await fetchSierjuClassesForProcessDefinition(courtId, processDefinitionId)
            : caseType
              ? await fetchSierjuClassesForCaseType(courtId, caseType)
              : [];
        if (cancelled) return;
        setClasses(rows);
        if (!rows.length) {
          setLoadError('Catálogo SIERJU no disponible para este tipo de proceso.');
        }
      } catch (e) {
        if (cancelled) return;
        setClasses([]);
        setLoadError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo SIERJU.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courtId, caseType, processDefinitionId]);

  const selectedValue = useMemo(() => {
    const byClass = findSierjuClassById(classes, valueClassId ?? undefined);
    if (byClass) return byClass.id;
    const byDerecho = findSierjuClassByDerecho(classes, valueDerechoCode);
    return byDerecho?.id ?? '';
  }, [classes, valueClassId, valueDerechoCode]);

  const sectionHint = useMemo(() => {
    const hit = findSierjuClassById(classes, selectedValue || undefined);
    if (!hit?.sectionLabel) return hint ?? null;
    return hint ?? `Sección formulario: ${hit.sectionLabel}`;
  }, [classes, selectedValue, hint]);

  return (
    <div className="min-w-[200px] flex-1 space-y-1">
      <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          className="input-modern min-h-[40px] flex-1 text-xs font-medium"
          value={selectedValue}
          disabled={disabled || saving || loading || !classes.length}
          onChange={(e) => {
            const nextId = e.target.value;
            const option = findSierjuClassById(classes, nextId || undefined);
            void onChange({
              derechoCode: option?.derechoTuteladoCode,
              classId: option?.id,
              option,
            });
          }}
        >
          <option value="">Sin clasificar</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {loading || saving ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden />
        ) : null}
      </div>
      {loadError ? (
        <p className="text-[11px] text-amber-700">{loadError}</p>
      ) : sectionHint ? (
        <p className="text-[11px] text-slate-400">{sectionHint}</p>
      ) : null}
    </div>
  );
}
