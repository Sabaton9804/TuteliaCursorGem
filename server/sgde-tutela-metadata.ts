import { COURT_CONSTANTS } from '../src/constants.js';
import { sgdeTipoDocumentalForActCode } from '../src/lib/case-act-types.ts';

/** Metadatos de serie/subserie para tutela de primera instancia en SGDE. */
export const SGDE_SERIE_TUTELA = 'Constitucional';
export const SGDE_SUBSERIE_TUTELA = 'Acciones Constitucionales de Tutela';

export type CourtRadicacionCuiRow = {
  dane_code?: string | null;
  entity_code?: string | null;
  specialty_code?: string | null;
  despacho_number?: string | null;
  name?: string | null;
};

export type SgdeExpedienteMetadataInput = {
  radicado23: string;
  claimant: string;
  defendant: string;
  courtName?: string;
  caseType?: string | null;
};

export const SGDE_SERIE_CIVIL = 'Civil';
export const SGDE_SUBSERIE_CIVIL = 'Procesos civiles';

function isCivilSgdeCaseType(caseType?: string | null): boolean {
  return String(caseType || '').startsWith('civil_');
}

export function courtRadicacionCode12FromRow(row?: CourtRadicacionCuiRow | null): string {
  const dane = (row?.dane_code || COURT_CONSTANTS.CITY_CODE).trim();
  const entity = (row?.entity_code || COURT_CONSTANTS.ENTITY_CODE).trim();
  const specialty = (row?.specialty_code || COURT_CONSTANTS.SPECIALTY_CODE).trim();
  const despacho = (row?.despacho_number || COURT_CONSTANTS.DESPACHO_CODE).trim();
  return `${dane}${entity}${specialty}${despacho}`.replace(/\D/g, '').slice(0, 12);
}

/** @deprecated Preferir courtRadicacionCode12FromRow con fila courts. */
export function courtRadicacionCode12(): string {
  return courtRadicacionCode12FromRow(null);
}

export function tituloExpedienteSgde(
  claimant: string,
  defendant: string,
  caseType?: string | null,
): string {
  const d = (claimant || '').replace(/\s+/g, ' ').trim();
  const dd = (defendant || '').replace(/\s+/g, ' ').trim();
  const civil = isCivilSgdeCaseType(caseType);
  const prefix = civil ? 'Proceso civil' : 'Tutela';
  let s = `${d} vs ${dd}`.trim();
  if (s.length < 3) s = prefix;
  const alreadyPrefixed = civil ? /^proceso civil\b/i.test(s) : /^tutela\b/i.test(s);
  if (!alreadyPrefixed) s = `${prefix} — ${s}`;
  return s.slice(0, 240);
}

export function nomOficinaProductoraSgde(courtName?: string): string {
  const name = (courtName || COURT_CONSTANTS.NAME || '').replace(/\s+/g, ' ').trim();
  return name.slice(0, 500);
}

export function buildSgdeExpedienteProperties(input: SgdeExpedienteMetadataInput): Record<string, string> {
  const cui = input.radicado23.replace(/\D/g, '').slice(0, 23);
  const civil = isCivilSgdeCaseType(input.caseType);
  return {
    'rama:nomExpediente': cui,
    'rama:nombreSerie': civil ? SGDE_SERIE_CIVIL : SGDE_SERIE_TUTELA,
    'rama:nomSubserie': civil ? SGDE_SUBSERIE_CIVIL : SGDE_SUBSERIE_TUTELA,
    'rama:nomOficinaProductora': nomOficinaProductoraSgde(input.courtName),
    'cm:title': tituloExpedienteSgde(input.claimant, input.defendant, input.caseType),
  };
}

function normalizeNameKey(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Infiera act_code desde nombre/type cuando la fila aún no lo trae
 * (misma semántica que el catálogo Tutelia → tipo SGDE).
 */
export function inferActCodeForSgdeTipo(name: string, docType?: string): string | null {
  const n = normalizeNameKey(name);
  if (docType === 'email_body' || (n.includes('correo') && n.includes('reparto'))) return 'correo_reparto';
  if (docType === 'informe_ingreso_expediente' || (n.includes('ingreso') && n.includes('despacho'))) {
    return 'informe_ingreso';
  }
  if (n.includes('acta') && n.includes('reparto')) return 'acta_reparto';
  if (n.includes('secuencia') && n.includes('reparto')) return 'correo_reparto';
  if (n.includes('anexo')) return 'anexos_pruebas';
  if (n.includes('escritodemanda') || (n.includes('demanda') && !n.includes('anexo') && !n.includes('contest'))) {
    return n.includes('tutela') ? 'escrito_tutela' : 'escrito_demanda';
  }
  if (n.includes('autoadmite') || n.includes('auto_admite')) return 'auto_admite';
  if (n.includes('autoinadm')) return 'auto_inadmite';
  if (n.includes('autorechaz')) return 'auto_rechazo';
  if (n.includes('mandamientopago') || n.includes('mandamiento')) return 'mandamiento_pago';
  if (n.includes('fallo')) return 'fallo_tutela';
  if (n.includes('sentencia')) return 'sentencia';
  if (n.includes('impugn')) return 'impugnacion_escrito';
  if (n.includes('apelacion')) return 'apelacion_escrito';
  if (n.includes('contestacion')) return 'contestacion_demanda';
  if (n.includes('notificacion')) return 'notificacion_admisorio';
  if (n.includes('constancia')) return 'constancia_notificacion';
  if (n.includes('actaaudiencia')) return 'acta_audiencia';
  if (n.includes('tituloejecutivo')) return 'titulo_ejecutivo';
  if (n.includes('excepcion')) return 'excepciones_ejecutivo';
  return null;
}

/**
 * Tipo documental SGDE (`rama:tipoDocumental`).
 * Prioridad: act_code del catálogo Tutelia → heurística de nombre/type.
 */
export function tipoDocumentalSgdeFromFileName(
  name: string,
  docType?: string,
  actCode?: string | null,
): string {
  const fromAct =
    sgdeTipoDocumentalForActCode(actCode) ??
    sgdeTipoDocumentalForActCode(inferActCodeForSgdeTipo(name, docType));
  if (fromAct) return fromAct;

  const n = normalizeNameKey(name);
  if (docType === 'email_body' || (n.includes('correo') && n.includes('reparto'))) {
    return 'Correo de reparto';
  }
  if (n.includes('acta') && n.includes('reparto')) return 'Acta de reparto';
  if (n.includes('ingreso') && n.includes('despacho')) return 'Ingreso a despacho';
  if (n.includes('anexo') || n.includes('prueba')) return 'Anexos';
  if (n.includes('demanda')) return 'Demanda';
  return 'Documento del expediente';
}

/** Prioridad de subida (menor = antes). */
export function uploadOrderPriority(name: string, docType?: string, actCode?: string | null): number {
  const code = (actCode || inferActCodeForSgdeTipo(name, docType) || '').trim();
  const byAct: Record<string, number> = {
    correo_reparto: 1,
    acta_reparto: 2,
    anexos_pruebas: 3,
    escrito_tutela: 4,
    escrito_demanda: 4,
    titulo_ejecutivo: 3,
    informe_ingreso: 5,
    auto_admite: 6,
    mandamiento_pago: 7,
  };
  if (code && byAct[code] != null) return byAct[code]!;

  const n = normalizeNameKey(name);
  if (docType === 'email_body' || (n.includes('correo') && n.includes('reparto'))) return 1;
  if (n.includes('acta') && n.includes('reparto')) return 2;
  if (n.includes('anexo') || n.includes('prueba')) return 3;
  if (n.includes('demanda')) return 4;
  if (n.includes('ingreso') && n.includes('despacho')) return 5;
  return 50;
}

/** Tipo documental en carpeta Impugnación (segunda instancia / traslado). */
export function tipoDocumentalSgdeSegundaFromFileName(
  name: string,
  docType?: string,
  actCode?: string | null,
): string {
  const n = normalizeNameKey(name);
  if (docType === 'email_body' || (n.includes('correo') && !n.includes('circuito'))) {
    return 'Correo de reparto';
  }
  if (n.includes('acta') && n.includes('reparto')) return 'Acta de reparto';
  if (n.includes('secuencia')) return 'Secuencia de reparto';
  if (n.includes('ingreso') && n.includes('despacho')) return 'Ingreso a despacho';
  if (n.includes('impugn')) return 'Memorial de impugnación';
  if (n.includes('memorial')) return 'Memorial';
  return tipoDocumentalSgdeFromFileName(name, docType, actCode);
}

export function uploadOrderPrioritySegunda(
  name: string,
  docType?: string,
  actCode?: string | null,
): number {
  const n = normalizeNameKey(name);
  if (docType === 'email_body' || n.includes('correoreparto')) return 1;
  if (n.includes('acta') && n.includes('reparto')) return 2;
  if (n.includes('secuencia')) return 3;
  if (n.includes('ingreso')) return 4;
  return uploadOrderPriority(name, docType, actCode);
}
