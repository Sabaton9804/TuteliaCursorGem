import type { DerechoTuteladoCode } from './sierju-case-codes';
import type { FundamentalRightCode } from './sierju-types';

/** Puente entre código legacy en cases.derecho_tutelado_code y fila SIERJU (snake lower). */
export const DERECHO_TO_FUNDAMENTAL: Record<DerechoTuteladoCode, FundamentalRightCode> = {
  SALUD: 'salud',
  SEGURIDAD_SOCIAL: 'seguridad_social',
  VIDA: 'vida',
  MINIMO_VITAL: 'minimo_vital',
  IGUALDAD: 'igualdad',
  EDUCACION: 'educacion',
  DEBIDO_PROCESO: 'debido_proceso',
  DERECHO_DE_PETICION: 'derecho_peticion',
  INFORMACION_PUBLICA: 'informacion_publica',
  CONTRA_PROVIDENCIAS_JUDICIALES: 'contra_providencias_judiciales',
  MEDIO_AMBIENTE: 'medio_ambiente',
  OTROS: 'otros',
};

export const FUNDAMENTAL_TO_DERECHO: Record<FundamentalRightCode, DerechoTuteladoCode> =
  Object.fromEntries(
    Object.entries(DERECHO_TO_FUNDAMENTAL).map(([d, f]) => [f, d as DerechoTuteladoCode]),
  ) as Record<FundamentalRightCode, DerechoTuteladoCode>;

export function derechoToFundamental(code: DerechoTuteladoCode): FundamentalRightCode {
  return DERECHO_TO_FUNDAMENTAL[code];
}

export function fundamentalToDerecho(code: FundamentalRightCode): DerechoTuteladoCode {
  return FUNDAMENTAL_TO_DERECHO[code];
}

export function sierjuClassCodeToDerecho(classCode: string): DerechoTuteladoCode | undefined {
  const normalized = classCode.trim().toUpperCase().replace(/-/g, '_');
  const asFundamental = classCode.trim().toLowerCase() as FundamentalRightCode;
  if (asFundamental in FUNDAMENTAL_TO_DERECHO) {
    return FUNDAMENTAL_TO_DERECHO[asFundamental];
  }
  if ((Object.keys(DERECHO_TO_FUNDAMENTAL) as DerechoTuteladoCode[]).includes(normalized as DerechoTuteladoCode)) {
    return normalized as DerechoTuteladoCode;
  }
  return undefined;
}
