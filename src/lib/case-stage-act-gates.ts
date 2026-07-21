import type { Document } from '../types';
import type { CaseType } from '../types';
import { CIVIL_CASE_TYPES, isCivilCaseType } from './process-product-scope';
import { caseHasAnyAct, caseHasRulingAct, labelForActCode } from './case-act-types';
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

const CIVIL_CASE_TYPE_LIST = CIVIL_CASE_TYPES as unknown as CaseType[];

const ADMISION_BRANCH_CASE_TYPES: CaseType[] = [
  'tutela_primera',
  'tutela_segunda',
  ...CIVIL_CASE_TYPE_LIST,
];

const STAGE_ACT_GATES: GateRule[] = [
  {
    trigger: 'SECRETARIA_NOTIFICACION_AUTO_ENVIADA',
    caseTypes: ['tutela_primera', ...CIVIL_CASE_TYPE_LIST],
    mode: 'all',
    requiredActs: ['auto_admite', 'notificacion_admisorio'],
    actionLabel: 'registrar la notificación del auto admisorio',
  },
  {
    trigger: 'SECRETARIA_NOTIFICACION_FALLO_ENVIADA',
    caseTypes: ['tutela_primera', 'tutela_segunda', ...CIVIL_CASE_TYPE_LIST],
    mode: 'all',
    requiredActs: ['fallo_tutela', 'notificacion_fallo'],
    actionLabel: 'registrar la notificación del fallo',
  },
  {
    trigger: 'SECRETARIA_IMPUGNACION_RECIBIDA',
    caseTypes: ['tutela_primera'],
    mode: 'all',
    requiredActs: ['impugnacion_escrito'],
    actionLabel: 'registrar la impugnación del fallo',
  },
  {
    trigger: 'SECRETARIA_REMISION_SUPERIOR',
    caseTypes: ['tutela_primera'],
    mode: 'all',
    requiredActs: ['remision_superior'],
    actionLabel: 'registrar la remisión al superior',
  },
  {
    trigger: 'SECRETARIA_REMISION_CORTE',
    caseTypes: ['tutela_segunda'],
    mode: 'all',
    requiredActs: ['remision_corte'],
    actionLabel: 'registrar la remisión a la Corte Constitucional',
  },
  {
    trigger: 'DESPACHO_INADMISION_REGISTRADA',
    caseTypes: ADMISION_BRANCH_CASE_TYPES,
    mode: 'all',
    requiredActs: ['auto_inadmite'],
    actionLabel: 'registrar la inadmisión',
  },
  {
    trigger: 'DESPACHO_RECHAZO_REGISTRADO',
    caseTypes: ADMISION_BRANCH_CASE_TYPES,
    mode: 'all',
    requiredActs: ['auto_rechazo'],
    actionLabel: 'registrar el rechazo de la demanda',
  },
  {
    trigger: 'SECRETARIA_APELACION_RECIBIDA',
    caseTypes: CIVIL_CASE_TYPE_LIST,
    mode: 'all',
    requiredActs: ['apelacion_escrito'],
    actionLabel: 'registrar la apelación de la sentencia',
  },
];

function formatMissingActs(codes: string[], caseType?: CaseType | null): string {
  const labels = codes.map((c) => labelForActCode(c, caseType) ?? c);
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
      message: `No puede ${rule.actionLabel} sin una pieza de ${formatMissingActs(rule.requiredActs, caseType)} en el expediente digital.`,
    };
  }

  const present = rule.requiredActs.filter((code) => caseHasAnyAct(docs, [code]));
  if (present.length === rule.requiredActs.length) return { ok: true };
  const missing = rule.requiredActs.filter((code) => !present.includes(code));
  return {
    ok: false,
    missingActs: missing,
    message: `Faltan piezas en el expediente: ${formatMissingActs(missing, caseType)}.`,
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
  if (!isCivilCaseType(caseType)) {
    return checkStageActGate('SECRETARIA_NOTIFICACION_FALLO_ENVIADA', caseType, docs);
  }
  if (!caseHasRulingAct(docs, caseType)) {
    return {
      ok: false,
      missingActs: ['sentencia'],
      message: 'Faltan piezas en el expediente: Sentencia (PDF firmado).',
    };
  }
  if (!caseHasAnyAct(docs, ['notificacion_fallo'])) {
    return {
      ok: false,
      missingActs: ['notificacion_fallo'],
      message: 'Faltan piezas en el expediente: Notificación de la sentencia.',
    };
  }
  return { ok: true };
}

export function canRegistrarImpugnacionRecibida(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('SECRETARIA_IMPUGNACION_RECIBIDA', caseType, docs);
}

export function canRegistrarRemisionSuperior(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('SECRETARIA_REMISION_SUPERIOR', caseType, docs);
}

export function canRegistrarRemisionCorte(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('SECRETARIA_REMISION_CORTE', caseType, docs);
}

export function canRegistrarApelacionRecibida(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('SECRETARIA_APELACION_RECIBIDA', caseType, docs);
}

export function canRegistrarRechazoDemanda(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('DESPACHO_RECHAZO_REGISTRADO', caseType, docs);
}

export function canRegistrarInadmision(
  caseType: CaseType,
  docs: Document[],
): StageActGateResult {
  return checkStageActGate('DESPACHO_INADMISION_REGISTRADA', caseType, docs);
}

export function stageActGateMessage(result: StageActGateResult): string | null {
  if (result.ok === false) return result.message;
  return null;
}
