import type { OutlookEmailClasificacion, VinculoExpediente } from './outlook-api';

export type { VinculoExpediente };

export function vinculoFromClassification(
  c: OutlookEmailClasificacion & { vinculo_expediente?: VinculoExpediente }
): VinculoExpediente {
  return c.vinculo_expediente ?? 'no_aplica';
}

export function requiereExpedienteTutela(tipo: OutlookEmailClasificacion['tipo']): boolean {
  return tipo === 'respuesta_tramite' || tipo === 'impugnacion';
}

export function etiquetaVinculo(vinculo: VinculoExpediente): string {
  switch (vinculo) {
    case 'encontrado':
      return 'Expediente vinculado';
    case 'no_encontrado':
      return 'Expediente no encontrado';
    case 'ambiguo':
      return 'Varios expedientes posibles';
    default:
      return 'Sin vinculación a tutela';
  }
}

export function mensajeVinculo(
  c: OutlookEmailClasificacion & {
    vinculo_expediente?: VinculoExpediente;
    referencia_proceso?: string | null;
  }
): string {
  const v = vinculoFromClassification(c);
  const ref = c.referencia_proceso || c.radicado_referencia;
  if (v === 'encontrado') {
    return ref
      ? `Tutela identificada para la referencia ${ref}. Revise y apruebe el ingreso.`
      : 'Se identificó un único expediente. Revise y apruebe el ingreso.';
  }
  if (v === 'no_encontrado') {
    return ref
      ? `No hay expediente en Tutelia para la referencia «${ref}». Verifique el número o radique la tutela antes de ingresar este correo.`
      : 'No se encontró expediente relacionado con las referencias del correo.';
  }
  if (v === 'ambiguo') {
    return ref
      ? `Hay varias tutelas que podrían corresponder a «${ref}». Elija el expediente correcto.`
      : 'Hay varios expedientes candidatos. Elija el correcto antes de aprobar.';
  }
  return 'Este correo no requiere vincular a un expediente existente (reparto u otro).';
}

export function puedeAprobarIngreso(
  c: OutlookEmailClasificacion & { vinculo_expediente?: VinculoExpediente },
  selectedCaseId: string
): boolean {
  const v = vinculoFromClassification(c);
  if (v === 'no_aplica') return Boolean(selectedCaseId);
  if (v === 'no_encontrado') return false;
  if (v === 'encontrado' || v === 'ambiguo') return Boolean(selectedCaseId);
  return false;
}
