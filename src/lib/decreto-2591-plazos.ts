/**
 * Plazos perentorios de la acción de tutela — Decreto 2591 de 1991
 * (reglamenta el art. 86 CP; gestor normativo Rama: i=5304).
 *
 * Los días son hábiles salvo que el decreto indique otra cosa (p. ej. 48 h en art. 27).
 */

import type { CaseType } from '../types';

export const DECRETO_2591_LABEL = 'Decreto 2591 de 1991';

/** Art. 29: fallo dentro de los 10 días siguientes a la presentación de la solicitud. */
export const PLAZO_FALLAR_PRIMERA_DIAS = 10;

/** Art. 31: impugnación dentro de los 3 días siguientes a la notificación del fallo. */
export const PLAZO_IMPUGNACION_DIAS = 3;

/** Art. 32: fallo de segunda instancia dentro de los 20 días siguientes a la recepción del expediente. */
export const PLAZO_FALLAR_SEGUNDA_DIAS = 20;

/** Art. 32 (inc. 1): remisión del expediente al superior dentro de los 2 días siguientes a la impugnación. */
export const PLAZO_REMISION_EXPEDIENTE_IMPUGNACION_DIAS = 2;

/** Art. 32 (inc. 2): remisión a la Corte dentro de los 10 días siguientes a la ejecutoria del fallo de segunda instancia. */
export const PLAZO_REMISION_CORTE_DIAS = 10;

/** Art. 19: informes de la autoridad (rango 1–3 días; la app usa 2 como práctica de traslado/contestación). */
export const PLAZO_INFORME_AUTORIDAD_MIN_DIAS = 1;
export const PLAZO_INFORME_AUTORIDAD_MAX_DIAS = 3;

/** Alias usados en etapas y `business-days.ts`. */
export const IMPUGNACION_BUSINESS_DAYS = PLAZO_IMPUGNACION_DIAS;

/** Tipos con plazo perentorio para fallar según D. 2591/1991 (solo tutela). */
export function isTutelaFalloPlazoCaseType(caseType?: CaseType): boolean {
  return caseType === 'tutela_primera' || caseType === 'tutela_segunda';
}

/** Plazo global del caso (días hábiles) según tipo de tutela en Tutelia. */
export function caseTermBusinessDaysFromDecreto2591(caseType?: CaseType): number | null {
  if (caseType === 'tutela_segunda') return PLAZO_FALLAR_SEGUNDA_DIAS;
  if (caseType === 'tutela_primera') return PLAZO_FALLAR_PRIMERA_DIAS;
  return null;
}

/** Texto corto para tablero / listas (etapa fallo notificado en primera instancia). */
export function impugnacionTermShortLabel(): string {
  return `Imp: ${PLAZO_IMPUGNACION_DIAS}d háb. (art. 31 D.2591/91)`;
}

/** Etiqueta del plazo global para fallar en ficha del expediente (solo tutela). */
export function plazoFallarLabelForCase(caseType?: CaseType): string | null {
  if (!isTutelaFalloPlazoCaseType(caseType)) return null;
  if (caseType === 'tutela_segunda') {
    return `Plazo para fallar (${PLAZO_FALLAR_SEGUNDA_DIAS} días háb. desde recepción del expediente — ${DECRETO_2591_LABEL} art. 32)`;
  }
  return `Plazo para fallar (${PLAZO_FALLAR_PRIMERA_DIAS} días háb. desde presentación de la solicitud — ${DECRETO_2591_LABEL} art. 29)`;
}

/** Nota al pie para ajuste manual del plazo global (solo tutela). */
export function plazoFallarAjusteManualHint(caseType?: CaseType): string | null {
  if (!isTutelaFalloPlazoCaseType(caseType)) return null;
  const days = caseTermBusinessDaysFromDecreto2591(caseType);
  if (days == null) return null;
  const art = caseType === 'tutela_segunda' ? 'art. 32' : 'art. 29';
  return `Ajuste manual del plazo para fallar (${days} días háb., ${DECRETO_2591_LABEL} ${art}, excepcional)`;
}
