import type { Case, Document } from '../types';
import { inferActCodeFromDocument } from './case-act-types';
import type { CaseStageCode } from './case-workflow-stages';
import { isCivilCaseType } from './process-product-scope';
import { isCivilEjecutivoCaseType } from './sgde-case-scope';

export type ContestacionPartyRow = {
  entityName: string;
  respuestaCargada: boolean;
  correoIngresado: boolean;
  piezasCount: number;
};

export type CaseContestacionChecklist = {
  parties: ContestacionPartyRow[];
  totalRequired: number;
  totalResponded: number;
  allResponded: boolean;
  plazoVencido: boolean;
  listoParaFallo: boolean;
  mensajeResumen: string;
};

function splitAccionados(defendant: string | undefined | null): string[] {
  if (!defendant?.trim()) return [];
  return defendant
    .split(/[,;]|(?:\s+y\s+)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeEntityKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function entityMatches(partyKey: string, docEntity: string): boolean {
  const dk = normalizeEntityKey(docEntity);
  if (!dk || !partyKey) return false;
  return dk.includes(partyKey) || partyKey.includes(dk);
}

export function buildCaseContestacionChecklist(opts: {
  caseItem: Case;
  docs: Document[];
  openStageCode?: CaseStageCode | null;
  plazoVencido?: boolean;
}): CaseContestacionChecklist {
  const { caseItem, docs, openStageCode, plazoVencido = false } = opts;
  const isCivil = isCivilCaseType(caseItem.caseType);
  const isEjecutivo = isCivilEjecutivoCaseType(caseItem.caseType);

  if (isEjecutivo) {
    const excepciones = docs.filter((d) => inferActCodeFromDocument(d) === 'excepciones_ejecutivo');
    const demandados = splitAccionados(caseItem.defendant);
    const parties: ContestacionPartyRow[] =
      demandados.length > 0
        ? demandados.map((name) => ({
            entityName: name,
            respuestaCargada: excepciones.length > 0,
            correoIngresado: false,
            piezasCount: excepciones.length,
          }))
        : [
            {
              entityName: caseItem.defendant?.trim() || 'Ejecutado',
              respuestaCargada: excepciones.length > 0,
              correoIngresado: false,
              piezasCount: excepciones.length,
            },
          ];
    const totalRequired = parties.length;
    const totalResponded = excepciones.length > 0 ? totalRequired : 0;
    const allResponded = excepciones.length > 0;
    const enTermino = openStageCode === 'TERMINO_EXCEPCIONES' || openStageCode === 'TRAMITE';
    const listoParaFallo = enTermino && (allResponded || plazoVencido);
    let mensajeResumen: string;
    if (allResponded) {
      mensajeResumen = 'Excepciones de mérito cargadas — puede cerrar el término e ingresar a trámite.';
    } else if (plazoVencido) {
      mensajeResumen = 'Plazo de excepciones vencido (CGP art. 443) — puede continuar ejecución / trámite.';
    } else {
      mensajeResumen = 'Pendiente excepciones de mérito o vencimiento del término (5 días hábiles).';
    }
    return {
      parties,
      totalRequired,
      totalResponded,
      allResponded,
      plazoVencido,
      listoParaFallo,
      mensajeResumen,
    };
  }

  if (isCivil) {
    const contestaciones = docs.filter((d) => inferActCodeFromDocument(d) === 'contestacion_demanda');
    const demandados = splitAccionados(caseItem.defendant);
    const parties: ContestacionPartyRow[] =
      demandados.length > 0
        ? demandados.map((name) => ({
            entityName: name,
            respuestaCargada: contestaciones.length > 0,
            correoIngresado: false,
            piezasCount: contestaciones.length,
          }))
        : [
            {
              entityName: caseItem.defendant?.trim() || 'Demandado',
              respuestaCargada: contestaciones.length > 0,
              correoIngresado: false,
              piezasCount: contestaciones.length,
            },
          ];
    const totalRequired = parties.length;
    const totalResponded = contestaciones.length > 0 ? totalRequired : 0;
    const allResponded = contestaciones.length > 0;
    const enTermino = openStageCode === 'TERMINO_RESPUESTA' || openStageCode === 'TRAMITE';
    const listoParaFallo = enTermino && (allResponded || plazoVencido);
    let mensajeResumen: string;
    if (allResponded) {
      mensajeResumen = 'Contestación de la demanda cargada — puede cerrar el término e ingresar a trámite.';
    } else if (plazoVencido) {
      mensajeResumen = 'Plazo de contestación vencido (CGP art. 76) — puede cerrar el término e ingresar a trámite.';
    } else {
      mensajeResumen = 'Pendiente contestación de la demanda o vencimiento del término (20 días hábiles).';
    }
    return {
      parties,
      totalRequired,
      totalResponded,
      allResponded,
      plazoVencido,
      listoParaFallo,
      mensajeResumen,
    };
  }

  const requiredNames = splitAccionados(caseItem.defendant);
  const partyKeys = requiredNames.map((n) => ({ name: n, key: normalizeEntityKey(n) }));

  const respuestaDocs = docs.filter((d) => {
    const code = inferActCodeFromDocument(d);
    return code === 'respuesta_accionado' || code === 'correo_contestacion';
  });

  const parties: ContestacionPartyRow[] = partyKeys.map(({ name, key }) => {
    const matched = respuestaDocs.filter((d) => {
      const pe = d.partyEntity?.trim();
      if (pe && entityMatches(key, pe)) return true;
      if (d.name && entityMatches(key, d.name)) return true;
      return false;
    });
    const respuesta = matched.some((d) => inferActCodeFromDocument(d) === 'respuesta_accionado');
    const correo = matched.some((d) => inferActCodeFromDocument(d) === 'correo_contestacion');
    return {
      entityName: name,
      respuestaCargada: respuesta,
      correoIngresado: correo,
      piezasCount: matched.length,
    };
  });

  if (parties.length === 0 && caseItem.defendant?.trim()) {
    const anyRespuesta = respuestaDocs.some((d) => inferActCodeFromDocument(d) === 'respuesta_accionado');
    parties.push({
      entityName: caseItem.defendant.trim(),
      respuestaCargada: anyRespuesta,
      correoIngresado: respuestaDocs.some((d) => inferActCodeFromDocument(d) === 'correo_contestacion'),
      piezasCount: respuestaDocs.length,
    });
  }

  const totalRequired = parties.length;
  const totalResponded = parties.filter((p) => p.respuestaCargada).length;
  const allResponded = totalRequired > 0 && totalResponded === totalRequired;
  const enTermino =
    openStageCode === 'TERMINO_RESPUESTA' || openStageCode === 'INGRESO_DESPACHO_FALLO';
  const listoParaFallo = enTermino && (allResponded || plazoVencido);

  let mensajeResumen: string;
  if (totalRequired === 0) {
    mensajeResumen = 'No hay accionados registrados en el expediente.';
  } else if (allResponded) {
    mensajeResumen = 'Todas las contestaciones están cargadas.';
  } else if (plazoVencido) {
    mensajeResumen = `Plazo vencido: faltan ${totalRequired - totalResponded} respuesta(s); puede proyectar fallo.`;
  } else {
    mensajeResumen = `Faltan ${totalRequired - totalResponded} respuesta(s) de accionado(s).`;
  }

  return {
    parties,
    totalRequired,
    totalResponded,
    allResponded,
    plazoVencido,
    listoParaFallo,
    mensajeResumen,
  };
}
