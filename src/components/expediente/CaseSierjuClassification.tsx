import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { CaseType } from '../../types';
import type { DerechoTuteladoCode } from '../../lib/sierju-case-codes';
import {
  fetchSierjuClassesForCaseType,
  fetchSierjuClassesForProcessDefinition,
  findSierjuClassByCode,
  findSierjuClassByDerecho,
  findSierjuClassById,
  type SierjuClassOption,
} from '../../lib/sierju-catalog-service';
import { SIERJU_CIVIL_ACTIVE_SECTION } from '../../lib/sierju-process-tipos';

type CaseSierjuClassificationProps = {
  courtId: string;
  caseType?: CaseType;
  processDefinitionId?: string | null;
  valueDerechoCode?: DerechoTuteladoCode;
  valueClassId?: string | null;
  /** Código TIPOS PROCESOS (civil oral), p. ej. declarativos_especiales_divisorio. */
  valueCode?: string | null;
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
  valueCode,
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
        // Preferir filtro por caseType (p. ej. tutelas → solo hoja 8 movimiento_tutelas).
        const rows = caseType
          ? await fetchSierjuClassesForCaseType(courtId, caseType)
          : processDefinitionId && processDefinitionId.trim()
            ? await fetchSierjuClassesForProcessDefinition(courtId, processDefinitionId)
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
    const byCode = findSierjuClassByCode(classes, valueCode, SIERJU_CIVIL_ACTIVE_SECTION);
    if (byCode) return byCode.id;
    // En civil casi todas las filas mapean a OTROS: no usar derecho como fallback.
    const isCivilSection = classes.some((c) => c.sectionCode.startsWith('civil'));
    if (isCivilSection) return '';
    const byDerecho = findSierjuClassByDerecho(classes, valueDerechoCode);
    return byDerecho?.id ?? '';
  }, [classes, valueClassId, valueCode, valueDerechoCode]);

  // Si el tipo ya está en el banner (valueCode) pero aún no hay classId, sincronizar al cargar el catálogo.
  useEffect(() => {
    if (loading || !classes.length || !valueCode?.trim()) return;
    if (valueClassId && findSierjuClassById(classes, valueClassId)) return;
    const byCode = findSierjuClassByCode(classes, valueCode, SIERJU_CIVIL_ACTIVE_SECTION);
    if (!byCode || byCode.id === valueClassId) return;
    void onChange({
      derechoCode: byCode.derechoTuteladoCode,
      classId: byCode.id,
      option: byCode,
    });
    // onChange del padre suele ser inline; solo re-sincronizar cuando cambian catálogo/código.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evitar bucles por identidad de onChange
  }, [loading, classes, valueCode, valueClassId]);

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
