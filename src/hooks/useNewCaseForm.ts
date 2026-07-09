import type { CaseAppellant, CaseOriginRuling, CaseType } from '../types';
import type { MvpRadicableCaseType } from '../lib/process-product-scope';

export const CASE_TYPE_CARD_COPY: Record<
  MvpRadicableCaseType,
  { emoji: string; title: string; subtitle: string }
> = {
  tutela_primera: {
    emoji: '📄',
    title: 'Primera instancia',
    subtitle: 'Tutela nueva por reparto',
  },
  tutela_segunda: {
    emoji: '📋',
    title: 'Segunda instancia',
    subtitle: 'Impugnación remitida por juzgado inferior',
  },
  consulta_desacato: {
    emoji: '🔍',
    title: 'Consulta de desacato',
    subtitle: 'Incidente remitido por otro juzgado para revisión',
  },
};

export function validateCaseOriginForRadicate(
  flow: CaseType,
  originCourt: string,
  originRadicado: string,
  appellant: '' | CaseAppellant,
  originRuling: '' | CaseOriginRuling,
  conductDescription: string,
): string | null {
  const court = originCourt.trim();
  const rad = originRadicado.trim();
  if (flow === 'tutela_segunda') {
    if (!court) return 'Indique el juzgado de origen.';
    if (!rad) return 'Indique el radicado de origen.';
    const digits = rad.replace(/\D/g, '');
    if (digits.length !== 23) {
      return 'El radicado de origen debe tener 23 dígitos (CUI de primera instancia).';
    }
    if (appellant !== 'accionante' && appellant !== 'accionado') {
      return 'Seleccione quién impugna: Accionante o Accionado.';
    }
    if (originRuling !== 'concedio' && originRuling !== 'nego') {
      return 'Indique el fallo de origen: Concedió o Negó.';
    }
    return null;
  }
  if (flow === 'consulta_desacato') {
    if (!court) return 'Indique el juzgado remitente.';
    if (!rad) return 'Indique el radicado de origen.';
    if (!conductDescription.trim()) {
      return 'Describa qué decisión o acto se consulta (campo obligatorio).';
    }
    return null;
  }
  return null;
}
