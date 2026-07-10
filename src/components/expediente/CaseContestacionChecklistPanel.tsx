import React, { useMemo } from 'react';
import { Check, Circle, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Case, Document } from '../../types';
import type { CaseStageCode } from '../../lib/case-workflow-stages';
import { buildCaseContestacionChecklist } from '../../lib/case-contestacion-checklist';
import { isCivilCaseType } from '../../lib/process-product-scope';
import { isCivilEjecutivoCaseType } from '../../lib/sgde-case-scope';

type Props = {
  caseItem: Case;
  docs: Document[];
  openStageCode?: CaseStageCode | null;
  plazoVencido?: boolean;
  compact?: boolean;
};

export function CaseContestacionChecklistPanel({
  caseItem,
  docs,
  openStageCode,
  plazoVencido,
  compact = false,
}: Props) {
  const checklist = useMemo(
    () =>
      buildCaseContestacionChecklist({
        caseItem,
        docs,
        openStageCode,
        plazoVencido,
      }),
    [caseItem, docs, openStageCode, plazoVencido],
  );

  if (checklist.parties.length === 0 && caseItem.caseType !== 'tutela_primera' && !isCivilCaseType(caseItem.caseType)) {
    return null;
  }

  const isCivil = isCivilCaseType(caseItem.caseType);
  const isEjecutivo = isCivilEjecutivoCaseType(caseItem.caseType);
  const panelTitle = isEjecutivo
    ? 'Excepciones de mérito'
    : isCivil
      ? 'Contestaciones de demandados'
      : 'Contestaciones de accionados';

  if (compact) {
    const relevantStages: CaseStageCode[] = isCivil
      ? ['TERMINO_RESPUESTA', 'TERMINO_EXCEPCIONES', 'TRAMITE', 'INGRESO_DESPACHO_FALLO']
      : ['TERMINO_RESPUESTA', 'INGRESO_DESPACHO_FALLO'];
    if (openStageCode && !relevantStages.includes(openStageCode)) return null;
  }

  return (
    <section
      className={`rounded-xl border ${
        checklist.listoParaFallo
          ? 'border-emerald-200 bg-emerald-50/80'
          : 'border-amber-200 bg-amber-50/60'
      } px-3 py-3`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">
            {panelTitle}
          </p>
          <p className="mt-1 text-xs text-slate-700">{checklist.mensajeResumen}</p>
        </div>
        {checklist.listoParaFallo ? (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-bold uppercase text-white">
            Listo para fallo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold uppercase text-white">
            <AlertTriangle className="h-3 w-3" />
            Pendiente
          </span>
        )}
      </div>

      {checklist.parties.length > 0 ? (
        <ul className={`mt-2 space-y-1 ${compact ? 'max-h-28 overflow-y-auto' : ''}`}>
          {checklist.parties.map((p) => (
            <li key={p.entityName} className="flex items-center gap-2 text-[11px] text-slate-800">
              {p.respuestaCargada ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span className="font-medium">{p.entityName}</span>
              <span className="text-slate-500">
                {p.respuestaCargada ? 'respuesta cargada' : 'sin respuesta'}
                {p.correoIngresado && !p.respuestaCargada ? ' · correo ingresado' : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!compact ? (
        <p className="mt-2 text-[10px] text-slate-600">
          Ingrese contestaciones desde{' '}
          <Link to="/correo/contestaciones" className="font-semibold underline">
            Contestaciones (correo)
          </Link>{' '}
          o suba la pieza «Respuesta entidad accionada» en el expediente.
        </p>
      ) : null}
    </section>
  );
}
