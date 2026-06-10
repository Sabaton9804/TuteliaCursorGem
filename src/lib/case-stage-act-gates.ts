import type { Document } from '../types';
import type { CaseType } from '../types';
import { caseHasAnyAct, labelForActCode } from './case-act-types';
import type { StageActTriggerCode } from './case-act-types';

export type StageActGateResult =
  | { ok: true }
  | { ok: false; message: string; missingActs: string[] };

type GateRule = {
  trigger: StageActTriggerCode;
  caseTypes: CaseType[];
  mode: 'any' | 'all';
  requiredActs: string[];
  actionLabel: string;
};

const STAGE_ACT_GATES: GateRule[] = [
  {
    trigger: 'SECRETARIA_NOTIFICACION_AUTO_ENVIADA',
    caseTypes: ['tutela_primera'],
    mode: 'any',
    requiredActs: ['notificacion_admisorio', 'constancia_notificacion'],
    actionLabel: 'registrar la notificación del auto admisorio',
  },
  {
    trigger: 'SECRETARIA_NOTIFICACION_FALLO_ENVIADA',
    caseTypes: ['tutela_primera'],
    mode: 'any',
    requiredActs: ['notificacion_fallo', 'constancia_notificacion_fallo'],
    actionLabel: 'registrar la notificación del fallo',
  },
];

function formatMissingActs(codes: string[]): string {
  const labels = codes.map((c) => labelForActCode(c) ?? c);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} o ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} o ${labels[labels.length - 1]}`;
}

export function checkStageActGate(
  trigger: StageActTriggerCode,
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  const rule = STAGE_ACT_GATES.find((g) => g.trigger === trigger);
  if (!rule) return { ok: true };
  if (!rule.caseTypes.includes(caseType)) return { ok: true };

  if (rule.mode === 'any') {
    if (caseHasAnyAct(docs, rule.requiredActs)) return { ok: true };
    return {
      ok: false,
      missingActs: rule.requiredActs,
      message: `No puede ${rule.actionLabel} sin una pieza de ${formatMissingActs(rule.requiredActs)} en el expediente digital.`,
    };
  }

  const present = rule.requiredActs.filter((code) => caseHasAnyAct(docs, [code]));
  if (present.length === rule.requiredActs.length) return { ok: true };
  const missing = rule.requiredActs.filter((code) => !present.includes(code));
  return {
    ok: false,
    missingActs: missing,
    message: `Faltan piezas en el expediente: ${formatMissingActs(missing)}.`,
  };
}

export function canRegistrarNotificacionAutoEnviada(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('SECRETARIA_NOTIFICACION_AUTO_ENVIADA', caseType, docs);
}

export function canRegistrarNotificacionFalloEnviada(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('SECRETARIA_NOTIFICACION_FALLO_ENVIADA', caseType, docs);
}

export function stageActGateMessage(result: StageActGateResult): string | null {
  if (result.ok === false) return result.message;
  return null;
}
