import type { Document } from '../types';
import type { CaseType } from '../types';
import { isCivilCaseType } from './process-product-scope';
import { isCivilEjecutivoCaseType } from './sgde-case-scope';
export type CaseActCode =
  | 'correo_reparto'
  | 'escrito_tutela'
  | 'acta_reparto'
  | 'anexos_pruebas'
  | 'informe_ingreso'
  | 'auto_admite'
  | 'notificacion_admisorio'
  | 'constancia_notificacion'
  | 'correo_contestacion'
  | 'respuesta_accionado'
  | 'auto_amplia_termino'
  | 'auto_requiere'
  | 'fallo_tutela'
  | 'notificacion_fallo'
  | 'constancia_notificacion_fallo'
  | 'impugnacion_escrito'
  | 'remision_superior'
  | 'remision_corte'
  | 'escrito_demanda'
  | 'contestacion_demanda'
  | 'sentencia'
  | 'auto_inadmite'
  | 'notificacion_inadmision'
  | 'auto_rechazo'
  | 'auto_interlocutorio'
  | 'prueba_documental'
  | 'acta_audiencia'
  | 'apelacion_escrito'
  | 'titulo_ejecutivo'
  | 'mandamiento_pago'
  | 'excepciones_ejecutivo'
  | 'auto_embargo';

/** Actos procesales tutela 1ª (alineados a `case_act_types.code`). */

export type CaseActSourceChannel = 'manual' | 'correo' | 'generado' | 'sgde' | 'radicacion';

export type StageActTriggerCode =
  | 'SECRETARIA_NOTIFICACION_AUTO_ENVIADA'
  | 'SECRETARIA_NOTIFICACION_FALLO_ENVIADA'
  | 'SECRETARIA_IMPUGNACION_RECIBIDA'
  | 'SECRETARIA_REMISION_SUPERIOR'
  | 'SECRETARIA_REMISION_CORTE'
  | 'DESPACHO_INADMISION_REGISTRADA'
  | 'DESPACHO_RECHAZO_REGISTRADO'
  | 'SECRETARIA_APELACION_RECIBIDA';

export type CaseActTypeDef = {
  code: CaseActCode;
  labelEs: string;
  /** Nombre protocolo CSJ (TitleCase, sin espacios). */
  suggestedFilename?: string;
  /**
   * Valor de `rama:tipoDocumental` en SGDE al sincronizar.
   * Fuente de verdad junto con `suggestedFilename` (nombre de archivo ↔ tipo).
   */
  sgdeTipoDocumental?: string;
  stageCode?: string;
  responsibleRole?: string;
  sortBand: number;
  repeatable?: boolean;
};

/** Tipo documental SGDE por acto (usado si el catálogo no trae `sgdeTipoDocumental`). */
export const SGDE_TIPO_DOCUMENTAL_BY_ACT: Readonly<Record<CaseActCode, string>> = {
  correo_reparto: 'Correo de reparto',
  escrito_tutela: 'Demanda',
  acta_reparto: 'Acta de reparto',
  anexos_pruebas: 'Anexos',
  informe_ingreso: 'Ingreso a despacho',
  auto_admite: 'Auto admisorio',
  notificacion_admisorio: 'Notificación',
  constancia_notificacion: 'Constancia',
  correo_contestacion: 'Correo',
  respuesta_accionado: 'Contestación',
  auto_amplia_termino: 'Auto interlocutorio',
  auto_requiere: 'Auto interlocutorio',
  fallo_tutela: 'Sentencia',
  notificacion_fallo: 'Notificación',
  constancia_notificacion_fallo: 'Constancia',
  impugnacion_escrito: 'Memorial de impugnación',
  remision_superior: 'Oficio',
  remision_corte: 'Oficio',
  escrito_demanda: 'Demanda',
  contestacion_demanda: 'Contestación',
  sentencia: 'Sentencia',
  auto_inadmite: 'Auto inadmisorio',
  notificacion_inadmision: 'Notificación',
  auto_rechazo: 'Auto de rechazo',
  auto_interlocutorio: 'Auto interlocutorio',
  prueba_documental: 'Anexos',
  acta_audiencia: 'Acta de audiencia',
  apelacion_escrito: 'Memorial',
  titulo_ejecutivo: 'Título ejecutivo',
  mandamiento_pago: 'Mandamiento de pago',
  excepciones_ejecutivo: 'Excepciones',
  auto_embargo: 'Auto interlocutorio',
};

/** Catálogo estático tutela 1ª (espejo del seed SQL hasta cargar desde BD). */
export const TUTELA_PRIMERA_ACT_TYPES: readonly CaseActTypeDef[] = [
  { code: 'correo_reparto', labelEs: 'Correo oficina de reparto', suggestedFilename: 'CorreoReparto.pdf', sgdeTipoDocumental: 'Correo de reparto', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 1 },
  { code: 'escrito_tutela', labelEs: 'Escrito de tutela / demanda', suggestedFilename: 'EscritoTutela.pdf', sgdeTipoDocumental: 'Demanda', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 2 },
  { code: 'acta_reparto', labelEs: 'Acta de reparto', suggestedFilename: 'ActaReparto.pdf', sgdeTipoDocumental: 'Acta de reparto', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 3 },
  { code: 'anexos_pruebas', labelEs: 'Anexos y pruebas', suggestedFilename: 'AnexosPruebas.pdf', sgdeTipoDocumental: 'Anexos', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 4 },
  { code: 'informe_ingreso', labelEs: 'Informe de ingreso al despacho', suggestedFilename: 'InformeIngresoDespacho.pdf', sgdeTipoDocumental: 'Ingreso a despacho', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 5 },
  { code: 'auto_admite', labelEs: 'Auto admisorio (PDF firmado)', suggestedFilename: 'AutoAdmiteTutela.pdf', sgdeTipoDocumental: 'Auto admisorio', stageCode: 'ADMISION', responsibleRole: 'despacho', sortBand: 6 },
  { code: 'notificacion_admisorio', labelEs: 'Notificación auto admisorio', suggestedFilename: 'NotificacionAutoAdmite.pdf', sgdeTipoDocumental: 'Notificación', stageCode: 'NOTIFICACION_AUTO_ADMISORIO', responsibleRole: 'escribiente', sortBand: 7 },
  { code: 'constancia_notificacion', labelEs: 'Constancia de notificación', suggestedFilename: 'ConstanciaNotificacion.pdf', sgdeTipoDocumental: 'Constancia', stageCode: 'NOTIFICACION_AUTO_ADMISORIO', responsibleRole: 'escribiente', sortBand: 8 },
  { code: 'correo_contestacion', labelEs: 'Correo de contestación (entrada)', suggestedFilename: 'CorreoContestacion.pdf', sgdeTipoDocumental: 'Correo', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'escribiente', sortBand: 9, repeatable: true },
  { code: 'respuesta_accionado', labelEs: 'Respuesta entidad accionada', suggestedFilename: 'RespuestaAccionado.pdf', sgdeTipoDocumental: 'Contestación', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'escribiente', sortBand: 10, repeatable: true },
  { code: 'auto_amplia_termino', labelEs: 'Auto amplía término', suggestedFilename: 'AutoAmpliaTermino.pdf', sgdeTipoDocumental: 'Auto interlocutorio', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'despacho', sortBand: 11 },
  { code: 'auto_requiere', labelEs: 'Auto de requerimiento', suggestedFilename: 'AutoRequiere.pdf', sgdeTipoDocumental: 'Auto interlocutorio', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'despacho', sortBand: 12 },
  { code: 'fallo_tutela', labelEs: 'Fallo de tutela (PDF firmado)', suggestedFilename: 'FalloTutela.pdf', sgdeTipoDocumental: 'Sentencia', stageCode: 'FALLO', responsibleRole: 'despacho', sortBand: 20 },
  { code: 'notificacion_fallo', labelEs: 'Notificación del fallo', suggestedFilename: 'NotificacionFallo.pdf', sgdeTipoDocumental: 'Notificación', stageCode: 'NOTIFICACION_FALLO', responsibleRole: 'escribiente', sortBand: 21 },
  { code: 'constancia_notificacion_fallo', labelEs: 'Constancia notificación fallo', suggestedFilename: 'ConstanciaNotifFallo.pdf', sgdeTipoDocumental: 'Constancia', stageCode: 'NOTIFICACION_FALLO', responsibleRole: 'escribiente', sortBand: 22 },
  { code: 'impugnacion_escrito', labelEs: 'Escrito de impugnación', suggestedFilename: 'ImpugnacionFallo.pdf', sgdeTipoDocumental: 'Memorial de impugnación', stageCode: 'IMPUGNACION', responsibleRole: 'secretaria', sortBand: 23 },
  { code: 'remision_superior', labelEs: 'Remisión al superior (impugnación)', suggestedFilename: 'RemisionSuperior.pdf', sgdeTipoDocumental: 'Oficio', stageCode: 'REMISION_SUPERIOR', responsibleRole: 'secretaria', sortBand: 24 },
  { code: 'remision_corte', labelEs: 'Remisión a la Corte Constitucional', suggestedFilename: 'RemisionCorte.pdf', sgdeTipoDocumental: 'Oficio', stageCode: 'REMISION_CORTE', responsibleRole: 'oficial_mayor', sortBand: 30 },
  { code: 'auto_inadmite', labelEs: 'Auto inadmisorio (PDF firmado)', suggestedFilename: 'AutoInadmite.pdf', sgdeTipoDocumental: 'Auto inadmisorio', stageCode: 'INADMISION', responsibleRole: 'despacho', sortBand: 6 },
  { code: 'notificacion_inadmision', labelEs: 'Notificación auto inadmisorio', suggestedFilename: 'NotificacionInadmision.pdf', sgdeTipoDocumental: 'Notificación', stageCode: 'INADMISION', responsibleRole: 'escribiente', sortBand: 7 },
  { code: 'auto_rechazo', labelEs: 'Auto de rechazo (PDF firmado)', suggestedFilename: 'AutoRechazoDemanda.pdf', sgdeTipoDocumental: 'Auto de rechazo', stageCode: 'RECHAZO', responsibleRole: 'despacho', sortBand: 6 },
] as const;

/** Catálogo civil ordinario / general (CGP). */
export const CIVIL_ORDINARIO_ACT_TYPES: readonly CaseActTypeDef[] = [
  { code: 'correo_reparto', labelEs: 'Correo oficina de reparto', suggestedFilename: 'CorreoReparto.pdf', sgdeTipoDocumental: 'Correo de reparto', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 1 },
  { code: 'acta_reparto', labelEs: 'Acta de reparto', suggestedFilename: 'ActaReparto.pdf', sgdeTipoDocumental: 'Acta de reparto', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 2 },
  { code: 'anexos_pruebas', labelEs: 'Anexos de la demanda', suggestedFilename: 'AnexosDemanda.pdf', sgdeTipoDocumental: 'Anexos', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 3 },
  { code: 'escrito_demanda', labelEs: 'Demanda / escrito inicial', suggestedFilename: 'EscritoDemanda.pdf', sgdeTipoDocumental: 'Demanda', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 4 },
  { code: 'informe_ingreso', labelEs: 'Informe de ingreso al despacho', suggestedFilename: 'InformeIngresoDespacho.pdf', sgdeTipoDocumental: 'Ingreso a despacho', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 5 },
  { code: 'auto_admite', labelEs: 'Auto admisorio (PDF firmado)', suggestedFilename: 'AutoAdmiteDemanda.pdf', sgdeTipoDocumental: 'Auto admisorio', stageCode: 'ADMISION', responsibleRole: 'despacho', sortBand: 6 },
  { code: 'notificacion_admisorio', labelEs: 'Notificación auto admisorio', suggestedFilename: 'NotificacionAutoAdmite.pdf', sgdeTipoDocumental: 'Notificación', stageCode: 'NOTIFICACION_AUTO_ADMISORIO', responsibleRole: 'escribiente', sortBand: 7 },
  { code: 'contestacion_demanda', labelEs: 'Contestación de la demanda', suggestedFilename: 'ContestacionDemanda.pdf', sgdeTipoDocumental: 'Contestación', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'escribiente', sortBand: 8, repeatable: true },
  { code: 'auto_interlocutorio', labelEs: 'Auto interlocutorio (trámite)', suggestedFilename: 'AutoInterlocutorio.pdf', sgdeTipoDocumental: 'Auto interlocutorio', stageCode: 'TRAMITE', responsibleRole: 'despacho', sortBand: 10, repeatable: true },
  { code: 'prueba_documental', labelEs: 'Prueba documental / decreto de pruebas', suggestedFilename: 'DecretoPruebas.pdf', sgdeTipoDocumental: 'Anexos', stageCode: 'TRAMITE', responsibleRole: 'despacho', sortBand: 11, repeatable: true },
  { code: 'acta_audiencia', labelEs: 'Acta de audiencia', suggestedFilename: 'ActaAudiencia.pdf', sgdeTipoDocumental: 'Acta de audiencia', stageCode: 'TRAMITE', responsibleRole: 'secretaria', sortBand: 12, repeatable: true },
  { code: 'sentencia', labelEs: 'Sentencia (PDF firmado)', suggestedFilename: 'Sentencia.pdf', sgdeTipoDocumental: 'Sentencia', stageCode: 'FALLO', responsibleRole: 'despacho', sortBand: 20 },
  { code: 'notificacion_fallo', labelEs: 'Notificación de la sentencia', suggestedFilename: 'NotificacionSentencia.pdf', sgdeTipoDocumental: 'Notificación', stageCode: 'NOTIFICACION_FALLO', responsibleRole: 'escribiente', sortBand: 21 },
  { code: 'apelacion_escrito', labelEs: 'Escrito de apelación', suggestedFilename: 'ApelacionSentencia.pdf', sgdeTipoDocumental: 'Memorial', stageCode: 'APELACION', responsibleRole: 'secretaria', sortBand: 22 },
  { code: 'auto_inadmite', labelEs: 'Auto inadmisorio (PDF firmado)', suggestedFilename: 'AutoInadmiteDemanda.pdf', sgdeTipoDocumental: 'Auto inadmisorio', stageCode: 'INADMISION', responsibleRole: 'despacho', sortBand: 30 },
  { code: 'auto_rechazo', labelEs: 'Auto de rechazo (PDF firmado)', suggestedFilename: 'AutoRechazoDemanda.pdf', sgdeTipoDocumental: 'Auto de rechazo', stageCode: 'RECHAZO', responsibleRole: 'despacho', sortBand: 31 },
] as const;

/** Catálogo proceso ejecutivo singular (CGP). */
export const CIVIL_EJECUTIVO_ACT_TYPES: readonly CaseActTypeDef[] = [
  { code: 'titulo_ejecutivo', labelEs: 'Título ejecutivo', suggestedFilename: 'TituloEjecutivo.pdf', sgdeTipoDocumental: 'Título ejecutivo', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 1 },
  { code: 'escrito_demanda', labelEs: 'Demanda ejecutiva', suggestedFilename: 'DemandaEjecutiva.pdf', sgdeTipoDocumental: 'Demanda', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 2 },
  { code: 'informe_ingreso', labelEs: 'Informe de ingreso al despacho', suggestedFilename: 'InformeIngresoDespacho.pdf', sgdeTipoDocumental: 'Ingreso a despacho', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 3 },
  { code: 'auto_admite', labelEs: 'Auto que ordena mandamiento de pago', suggestedFilename: 'AutoMandamientoPago.pdf', sgdeTipoDocumental: 'Auto admisorio', stageCode: 'ADMISION', responsibleRole: 'despacho', sortBand: 4 },
  { code: 'mandamiento_pago', labelEs: 'Mandamiento de pago (PDF firmado)', suggestedFilename: 'MandamientoPago.pdf', sgdeTipoDocumental: 'Mandamiento de pago', stageCode: 'ADMISION', responsibleRole: 'despacho', sortBand: 5 },
  { code: 'notificacion_admisorio', labelEs: 'Notificación mandamiento de pago', suggestedFilename: 'NotificacionMandamientoPago.pdf', sgdeTipoDocumental: 'Notificación', stageCode: 'NOTIFICACION_AUTO_ADMISORIO', responsibleRole: 'escribiente', sortBand: 6 },
  { code: 'excepciones_ejecutivo', labelEs: 'Excepciones de mérito', suggestedFilename: 'ExcepcionesEjecutivo.pdf', sgdeTipoDocumental: 'Excepciones', stageCode: 'TERMINO_EXCEPCIONES', responsibleRole: 'escribiente', sortBand: 7, repeatable: true },
  { code: 'auto_embargo', labelEs: 'Auto de embargo / medida cautelar', suggestedFilename: 'AutoEmbargo.pdf', sgdeTipoDocumental: 'Auto interlocutorio', stageCode: 'TRAMITE', responsibleRole: 'despacho', sortBand: 10, repeatable: true },
  { code: 'auto_interlocutorio', labelEs: 'Auto interlocutorio (trámite)', suggestedFilename: 'AutoInterlocutorio.pdf', sgdeTipoDocumental: 'Auto interlocutorio', stageCode: 'TRAMITE', responsibleRole: 'despacho', sortBand: 11, repeatable: true },
  { code: 'sentencia', labelEs: 'Sentencia / auto que continúa ejecución', suggestedFilename: 'SentenciaEjecutivo.pdf', sgdeTipoDocumental: 'Sentencia', stageCode: 'FALLO', responsibleRole: 'despacho', sortBand: 20 },
  { code: 'notificacion_fallo', labelEs: 'Notificación de la sentencia', suggestedFilename: 'NotificacionSentencia.pdf', sgdeTipoDocumental: 'Notificación', stageCode: 'NOTIFICACION_FALLO', responsibleRole: 'escribiente', sortBand: 21 },
  { code: 'apelacion_escrito', labelEs: 'Escrito de apelación', suggestedFilename: 'ApelacionSentencia.pdf', sgdeTipoDocumental: 'Memorial', stageCode: 'APELACION', responsibleRole: 'secretaria', sortBand: 22 },
  { code: 'auto_inadmite', labelEs: 'Auto inadmisorio (PDF firmado)', suggestedFilename: 'AutoInadmiteDemanda.pdf', sgdeTipoDocumental: 'Auto inadmisorio', stageCode: 'INADMISION', responsibleRole: 'despacho', sortBand: 30 },
  { code: 'auto_rechazo', labelEs: 'Auto de rechazo (PDF firmado)', suggestedFilename: 'AutoRechazoDemanda.pdf', sgdeTipoDocumental: 'Auto de rechazo', stageCode: 'RECHAZO', responsibleRole: 'despacho', sortBand: 31 },
] as const;

export function sgdeTipoDocumentalForActCode(actCode: string | null | undefined): string | null {
  if (!actCode?.trim()) return null;
  const code = actCode.trim() as CaseActCode;
  const fromCatalog =
    TUTELA_PRIMERA_ACT_TYPES.find((a) => a.code === code)?.sgdeTipoDocumental ??
    CIVIL_ORDINARIO_ACT_TYPES.find((a) => a.code === code)?.sgdeTipoDocumental ??
    CIVIL_EJECUTIVO_ACT_TYPES.find((a) => a.code === code)?.sgdeTipoDocumental;
  if (fromCatalog?.trim()) return fromCatalog.trim();
  return SGDE_TIPO_DOCUMENTAL_BY_ACT[code] ?? null;
}

/** @deprecated Usar actCatalogForCaseType */
export const CIVIL_ACT_TYPES = CIVIL_ORDINARIO_ACT_TYPES;

/** Fallback sin caseType: ordinario antes que ejecutivo (mismo code, distinta etiqueta). */
const ACT_LABEL_BY_CODE = new Map<string, string>();
for (const a of [
  ...TUTELA_PRIMERA_ACT_TYPES,
  ...CIVIL_EJECUTIVO_ACT_TYPES,
  ...CIVIL_ORDINARIO_ACT_TYPES,
]) {
  ACT_LABEL_BY_CODE.set(a.code, a.labelEs);
}

/** Inferencia para piezas legacy sin `act_code` en BD. */
export function inferActCodeFromDocument(doc: Document): string | null {
  const explicit = doc.actCode?.trim();
  if (explicit) return explicit;
  if (doc.type === 'email_body' || doc.name === 'CorreoReparto' || /^CorreoReparto/i.test(doc.name))
    return 'correo_reparto';
  if (doc.type === 'informe_ingreso_expediente' || /^InformeIngreso/i.test(doc.name)) return 'informe_ingreso';
  if (/^AutoInadm/i.test(doc.name)) return 'auto_inadmite';
  if (/^AutoRechaz/i.test(doc.name)) return 'auto_rechazo';
  if (/^AutoAdmite/i.test(doc.name)) return 'auto_admite';
  if (/^NotificacionAuto/i.test(doc.name)) return 'notificacion_admisorio';
  if (/^ConstanciaNotif/i.test(doc.name) && /Fallo/i.test(doc.name)) return 'constancia_notificacion_fallo';
  if (/^ConstanciaNotif/i.test(doc.name)) return 'constancia_notificacion';
  if (/^Fallo/i.test(doc.name)) return 'fallo_tutela';
  if (/\d+fallo/i.test(doc.name) && !/notificacion/i.test(doc.name)) return 'fallo_tutela';
  if (/^Sentencia/i.test(doc.name)) return 'sentencia';
  if (/^AutoInterloc/i.test(doc.name)) return 'auto_interlocutorio';
  if (/^DecretoPruebas/i.test(doc.name) || /^Prueba/i.test(doc.name)) return 'prueba_documental';
  if (/^ActaAudiencia/i.test(doc.name)) return 'acta_audiencia';
  if (/^Contestacion/i.test(doc.name)) return 'contestacion_demanda';
  if (/^Excepciones/i.test(doc.name)) return 'excepciones_ejecutivo';
  if (/^TituloEjecutivo/i.test(doc.name)) return 'titulo_ejecutivo';
  if (/^MandamientoPago/i.test(doc.name)) return 'mandamiento_pago';
  if (/^AutoEmbargo/i.test(doc.name)) return 'auto_embargo';
  if (/^Apelacion/i.test(doc.name)) return 'apelacion_escrito';
  if (/^Anexos/i.test(doc.name)) return 'anexos_pruebas';
  if (/^EscritoDemanda/i.test(doc.name) || /^DemandaEjecutiva/i.test(doc.name)) return 'escrito_demanda';
  if (/^Demanda/i.test(doc.name) && !/^Demandado/i.test(doc.name)) return 'escrito_demanda';
  // Nombres SGDE / juzgado (p. ej. 001001demandaanexos01): no vienen en TitleCase Tutelia.
  const raw = `${doc.name || ''} ${doc.originalName || ''}`.toLowerCase();
  if (/falloniega|fallotutel/.test(raw) && !/notificacion|notificadoautoconcede/.test(raw)) {
    return 'fallo_tutela';
  }
  if (/anexo|anexos/.test(raw) && !/auto|sentencia|fallo/.test(raw)) {
    return 'anexos_pruebas';
  }
  if (/prueba|evidencia|decretopruebas/.test(raw) && !/auto|sentencia|fallo/.test(raw)) {
    return /tutela|accion/.test(raw) ? 'anexos_pruebas' : 'prueba_documental';
  }
  if (/demanda|escrito.?inicial|escrito.?demanda/.test(raw) && !/contestaci[oó]n/.test(raw)) {
    if (/tutela/.test(raw)) return 'escrito_tutela';
    return 'escrito_demanda';
  }
  if (/^Respuesta/i.test(doc.name)) return 'respuesta_accionado';
  return null;
}

export function actCodesPresentInExpediente(docs: Document[]): Set<string> {
  const out = new Set<string>();
  for (const d of docs) {
    const code = inferActCodeFromDocument(d);
    if (code) out.add(code);
  }
  return out;
}

export function caseHasAnyAct(docs: Document[], actCodes: readonly string[]): boolean {
  const present = actCodesPresentInExpediente(docs);
  return actCodes.some((c) => present.has(c));
}

export function actCatalogForCaseType(caseType: CaseType | null | undefined): readonly CaseActTypeDef[] {
  if (caseType === 'tutela_primera') return TUTELA_PRIMERA_ACT_TYPES;
  if (caseType && isCivilEjecutivoCaseType(caseType)) return CIVIL_EJECUTIVO_ACT_TYPES;
  if (caseType && isCivilCaseType(caseType)) return CIVIL_ORDINARIO_ACT_TYPES;
  return [];
}

export function labelForActCode(
  code: string | null | undefined,
  caseType?: CaseType | null,
): string | null {
  if (!code?.trim()) return null;
  const catalog = actCatalogForCaseType(caseType);
  const fromCatalog = catalog.find((a) => a.code === code)?.labelEs;
  if (fromCatalog) return fromCatalog;
  return ACT_LABEL_BY_CODE.get(code) ?? null;
}

export type ActTimelineEntry = {
  code: CaseActCode;
  labelEs: string;
  sortBand: number;
  present: boolean;
  count: number;
  optional: boolean;
};

const OPTIONAL_ACT_CODES = new Set<string>(['auto_amplia_termino', 'auto_requiere', 'correo_contestacion']);

export function caseHasRulingAct(docs: Document[], caseType: CaseType): boolean {
  if (isCivilCaseType(caseType)) {
    return caseHasAnyAct(docs, ['sentencia', 'fallo_tutela']);
  }
  return caseHasAnyAct(docs, ['fallo_tutela']);
}

/** Actos que el escribiente/secretaría puede elegir al subir manualmente (tutela). */
export const UPLOADABLE_ACT_CODES_TUTELA: readonly CaseActCode[] = [
  'anexos_pruebas',
  'informe_ingreso',
  'notificacion_admisorio',
  'constancia_notificacion',
  'correo_contestacion',
  'respuesta_accionado',
  'auto_admite',
  'fallo_tutela',
  'notificacion_fallo',
  'constancia_notificacion_fallo',
  'impugnacion_escrito',
  'remision_superior',
  'remision_corte',
];

/** Actos subibles en expediente civil ordinario (CGP). */
export const UPLOADABLE_ACT_CODES_CIVIL_ORDINARIO: readonly CaseActCode[] = [
  'escrito_demanda',
  'informe_ingreso',
  'auto_admite',
  'notificacion_admisorio',
  'contestacion_demanda',
  'auto_interlocutorio',
  'prueba_documental',
  'acta_audiencia',
  'sentencia',
  'notificacion_fallo',
  'apelacion_escrito',
  'auto_inadmite',
  'auto_rechazo',
];

/** Actos subibles en proceso ejecutivo (CGP). */
export const UPLOADABLE_ACT_CODES_CIVIL_EJECUTIVO: readonly CaseActCode[] = [
  'titulo_ejecutivo',
  'escrito_demanda',
  'informe_ingreso',
  'auto_admite',
  'mandamiento_pago',
  'notificacion_admisorio',
  'excepciones_ejecutivo',
  'auto_embargo',
  'auto_interlocutorio',
  'sentencia',
  'notificacion_fallo',
  'apelacion_escrito',
  'auto_inadmite',
  'auto_rechazo',
];

/** @deprecated Usar UPLOADABLE_ACT_CODES_CIVIL_ORDINARIO */
export const UPLOADABLE_ACT_CODES_CIVIL = UPLOADABLE_ACT_CODES_CIVIL_ORDINARIO;

/** @deprecated Usar uploadableActsForCaseType */
export const UPLOADABLE_ACT_CODES = UPLOADABLE_ACT_CODES_TUTELA;

export function uploadableActsForCaseType(caseType: CaseType | null | undefined): CaseActTypeDef[] {
  const catalog = actCatalogForCaseType(caseType);
  if (catalog.length === 0) return [];
  const allowed = new Set<string>(
    caseType && isCivilEjecutivoCaseType(caseType)
      ? UPLOADABLE_ACT_CODES_CIVIL_EJECUTIVO
      : caseType && isCivilCaseType(caseType)
        ? UPLOADABLE_ACT_CODES_CIVIL_ORDINARIO
        : UPLOADABLE_ACT_CODES_TUTELA,
  );
  return catalog.filter((a) => allowed.has(a.code));
}

export function actRequiresPartyEntity(actCode: string): boolean {
  return actCode === 'respuesta_accionado' || actCode === 'correo_contestacion';
}

/** TitleCase sin espacios para nombres de archivo (protocolo CSJ). */
export function sanitizePartyEntityForFilename(
  entity: string,
  caseType?: CaseType | null,
): string {
  const cleaned = entity
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 28);
  if (cleaned) return cleaned;
  return isCivilCaseType(caseType) ? 'Demandado' : 'Accionado';
}

export function suggestedLogicalNameForAct(
  actCode: string,
  opts?: { partyEntity?: string; originalFilename?: string; caseType?: CaseType },
): string {
  const catalog = actCatalogForCaseType(opts?.caseType);
  const def =
    catalog.find((a) => a.code === actCode) ??
    TUTELA_PRIMERA_ACT_TYPES.find((a) => a.code === actCode) ??
    CIVIL_ORDINARIO_ACT_TYPES.find((a) => a.code === actCode) ??
    CIVIL_EJECUTIVO_ACT_TYPES.find((a) => a.code === actCode);
  let base = def?.suggestedFilename?.replace(/\.pdf$/i, '') ?? 'Documento';
  if (actCode === 'respuesta_accionado' && opts?.partyEntity?.trim()) {
    base = `Respuesta${sanitizePartyEntityForFilename(opts.partyEntity, opts.caseType)}`;
  }
  const ext = opts?.originalFilename?.match(/\.([a-zA-Z0-9]+)$/i)?.[1]?.toLowerCase() ?? 'pdf';
  const safeExt = ext === 'jpeg' || ext === 'jpg' ? 'pdf' : ext;
  return `${base}.${safeExt}`;
}

export function nextActSequenceForDocs(docs: Document[], actCode: string, caseType?: CaseType): number {
  const catalog = actCatalogForCaseType(caseType);
  const def = catalog.find((a) => a.code === actCode) ?? TUTELA_PRIMERA_ACT_TYPES.find((a) => a.code === actCode);
  const band = def?.sortBand ?? 50;
  const existing = docs
    .map((d) => d.actSequence ?? (inferActCodeFromDocument(d) === actCode ? band : null))
    .filter((n): n is number => n != null);
  if (existing.length === 0) return band;
  return Math.max(...existing) + 1;
}

/** Timeline de actos esperados vs piezas cargadas (tutela 1ª). */
export function buildActTimeline(docs: Document[], caseType: CaseType | null | undefined): ActTimelineEntry[] {
  const catalog = actCatalogForCaseType(caseType);
  if (catalog.length === 0) return [];

  const counts = new Map<string, number>();
  for (const d of docs) {
    const code = inferActCodeFromDocument(d);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return catalog.map((a) => ({
    code: a.code,
    labelEs: a.labelEs,
    sortBand: a.sortBand,
    present: (counts.get(a.code) ?? 0) > 0,
    count: counts.get(a.code) ?? 0,
    optional: OPTIONAL_ACT_CODES.has(a.code),
  }));
}

/** Orden de listado: act_sequence explícito, luego sort_band del acto, luego sort_order. */
export function sortDocumentsByActTimeline(docs: Document[], caseType: CaseType | null | undefined): Document[] {
  const bandByCode = new Map<string, number>(
    actCatalogForCaseType(caseType).map((a) => [a.code, a.sortBand]),
  );
  return [...docs].sort((a, b) => {
    const actA = inferActCodeFromDocument(a);
    const actB = inferActCodeFromDocument(b);
    // act_sequence en piezas SGDE es rama:idDocumento (pares), no banda de acto procesal.
    const seqA =
      actA && a.actSequence != null
        ? a.actSequence
        : actA
          ? (bandByCode.get(actA) ?? 50) * 100
          : (a.order ?? 0);
    const seqB =
      actB && b.actSequence != null
        ? b.actSequence
        : actB
          ? (bandByCode.get(actB) ?? 50) * 100
          : (b.order ?? 0);
    if (seqA !== seqB) return seqA - seqB;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}
