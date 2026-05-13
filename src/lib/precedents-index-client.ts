import type { Case } from '../types';
import type { DecisionType } from './sierju-case-codes';
import { DECISION_TYPE_LABELS } from './sierju-case-codes';

/**
 * Tras registrar `decision_type` en el expediente: indexa el fallo en la biblioteca vía `/api/precedents/index`.
 * Segundo plano; no bloquea UI. Errores solo en consola.
 */
export function schedulePrecedentIndexAfterDecisionType(c: Case, decisionType: DecisionType): void {
  const tags = c.legalDerechoTutelado?.trim() ? [c.legalDerechoTutelado.trim()] : [];
  const legalArguments = (c.legalHechos || c.legalPretensiones || '').trim();
  const body = {
    caseId: c.id,
    courtId: c.courtId,
    sourceType: 'despacho',
    sourceCorporation: null,
    radicado: c.radicado,
    rightProtected: c.legalDerechoTutelado || '',
    defendant: c.defendant,
    rulingSense: DECISION_TYPE_LABELS[decisionType],
    legalArguments,
    summary: c.summary?.trim() || '',
    decisionDate: new Date().toISOString().slice(0, 10),
    tags,
  };
  void fetch('/api/precedents/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => console.error('[precedents/index]', e));
}
