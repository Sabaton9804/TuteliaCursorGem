import { COURT_CONSTANTS } from '../src/constants.js';

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
};

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

export function tituloExpedienteSgde(claimant: string, defendant: string): string {
  const d = (claimant || '').replace(/\s+/g, ' ').trim();
  const dd = (defendant || '').replace(/\s+/g, ' ').trim();
  let s = `${d} vs ${dd}`.trim();
  if (s.length < 3) s = 'Tutela';
  if (!/^tutela\b/i.test(s)) s = `Tutela — ${s}`;
  return s.slice(0, 240);
}

export function nomOficinaProductoraSgde(courtName?: string): string {
  const name = (courtName || COURT_CONSTANTS.NAME || '').replace(/\s+/g, ' ').trim();
  return name.slice(0, 500);
}

export function buildSgdeExpedienteProperties(input: SgdeExpedienteMetadataInput): Record<string, string> {
  const cui = input.radicado23.replace(/\D/g, '').slice(0, 23);
  return {
    'rama:nomExpediente': cui,
    'rama:nombreSerie': SGDE_SERIE_TUTELA,
    'rama:nomSubserie': SGDE_SUBSERIE_TUTELA,
    'rama:nomOficinaProductora': nomOficinaProductoraSgde(input.courtName),
    'cm:title': tituloExpedienteSgde(input.claimant, input.defendant),
  };
}

/** Tipo documental SGDE según nombre lógico Tutelia (MVP sin IA). */
export function tipoDocumentalSgdeFromFileName(name: string, docType?: string): string {
  const n = (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (docType === 'email_body' || (n.includes('correo') && n.includes('reparto'))) {
    return 'Correo de reparto';
  }
  if (n.includes('acta') && n.includes('reparto')) return 'Acta de reparto';
  if (n.includes('demanda')) return 'Demanda';
  if (n.includes('anexo') || n.includes('prueba')) return 'Anexos';
  return 'Documento del expediente';
}

/** Prioridad de subida (menor = antes). */
export function uploadOrderPriority(name: string, docType?: string): number {
  const n = (name || '').toLowerCase();
  if (docType === 'email_body' || (n.includes('correo') && n.includes('reparto'))) return 1;
  if (n.includes('acta') && n.includes('reparto')) return 2;
  if (n.includes('anexo') || n.includes('prueba')) return 3;
  if (n.includes('demanda')) return 4;
  return 50;
}

/** Tipo documental en carpeta Impugnación (segunda instancia / traslado). */
export function tipoDocumentalSgdeSegundaFromFileName(name: string, docType?: string): string {
  const n = (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (docType === 'email_body' || (n.includes('correo') && !n.includes('circuito'))) {
    return 'Correo de reparto';
  }
  if (n.includes('acta') && n.includes('reparto')) return 'Acta de reparto';
  if (n.includes('secuencia')) return 'Secuencia de reparto';
  if (n.includes('ingreso') && n.includes('despacho')) return 'Ingreso a despacho';
  if (n.includes('impugn')) return 'Memorial de impugnación';
  if (n.includes('memorial')) return 'Memorial';
  return tipoDocumentalSgdeFromFileName(name, docType);
}

export function uploadOrderPrioritySegunda(name: string, docType?: string): number {
  const n = (name || '').toLowerCase();
  if (docType === 'email_body' || n.includes('correoreparto')) return 1;
  if (n.includes('acta') && n.includes('reparto')) return 2;
  if (n.includes('secuencia')) return 3;
  if (n.includes('ingreso')) return 4;
  return uploadOrderPriority(name, docType);
}
