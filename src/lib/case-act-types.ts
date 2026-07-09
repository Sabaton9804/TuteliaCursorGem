import type { Document } from '../types';
import type { CaseType } from '../types';

/** Actos procesales tutela 1ª (alineados a `case_act_types.code`). */
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
  | 'remision_corte';

export type CaseActSourceChannel = 'manual' | 'correo' | 'generado' | 'sgde' | 'radicacion';

export type StageActTriggerCode =
  | 'SECRETARIA_NOTIFICACION_AUTO_ENVIADA'
  | 'SECRETARIA_NOTIFICACION_FALLO_ENVIADA';

export type CaseActTypeDef = {
  code: CaseActCode;
  labelEs: string;
  suggestedFilename?: string;
  stageCode?: string;
  responsibleRole?: string;
  sortBand: number;
  repeatable?: boolean;
};

/** Catálogo estático tutela 1ª (espejo del seed SQL hasta cargar desde BD). */
export const TUTELA_PRIMERA_ACT_TYPES: readonly CaseActTypeDef[] = [
  { code: 'correo_reparto', labelEs: 'Correo oficina de reparto', suggestedFilename: 'CorreoReparto.pdf', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 1 },
  { code: 'escrito_tutela', labelEs: 'Escrito de tutela / demanda', suggestedFilename: 'EscritoTutela.pdf', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 2 },
  { code: 'acta_reparto', labelEs: 'Acta de reparto', suggestedFilename: 'ActaReparto.pdf', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 3 },
  { code: 'anexos_pruebas', labelEs: 'Anexos y pruebas', suggestedFilename: 'AnexosPruebas.pdf', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 4 },
  { code: 'informe_ingreso', labelEs: 'Informe de ingreso al despacho', suggestedFilename: 'InformeIngresoDespacho.pdf', stageCode: 'RADICACION', responsibleRole: 'secretaria', sortBand: 5 },
  { code: 'auto_admite', labelEs: 'Auto admisorio (PDF firmado)', suggestedFilename: 'AutoAdmiteTutela.pdf', stageCode: 'ADMISION', responsibleRole: 'despacho', sortBand: 6 },
  { code: 'notificacion_admisorio', labelEs: 'Notificación auto admisorio', suggestedFilename: 'NotificacionAutoAdmite.pdf', stageCode: 'NOTIFICACION_AUTO_ADMISORIO', responsibleRole: 'escribiente', sortBand: 7 },
  { code: 'constancia_notificacion', labelEs: 'Constancia de notificación', suggestedFilename: 'ConstanciaNotificacion.pdf', stageCode: 'NOTIFICACION_AUTO_ADMISORIO', responsibleRole: 'escribiente', sortBand: 8 },
  { code: 'correo_contestacion', labelEs: 'Correo de contestación (entrada)', suggestedFilename: 'CorreoContestacion.pdf', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'escribiente', sortBand: 9, repeatable: true },
  { code: 'respuesta_accionado', labelEs: 'Respuesta entidad accionada', suggestedFilename: 'RespuestaAccionado.pdf', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'escribiente', sortBand: 10, repeatable: true },
  { code: 'auto_amplia_termino', labelEs: 'Auto amplía término', suggestedFilename: 'AutoAmpliaTermino.pdf', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'despacho', sortBand: 11 },
  { code: 'auto_requiere', labelEs: 'Auto de requerimiento', suggestedFilename: 'AutoRequiere.pdf', stageCode: 'TERMINO_RESPUESTA', responsibleRole: 'despacho', sortBand: 12 },
  { code: 'fallo_tutela', labelEs: 'Fallo de tutela (PDF firmado)', suggestedFilename: 'FalloTutela.pdf', stageCode: 'FALLO', responsibleRole: 'despacho', sortBand: 20 },
  { code: 'notificacion_fallo', labelEs: 'Notificación del fallo', suggestedFilename: 'NotificacionFallo.pdf', stageCode: 'NOTIFICACION_FALLO', responsibleRole: 'escribiente', sortBand: 21 },
  { code: 'constancia_notificacion_fallo', labelEs: 'Constancia notificación fallo', suggestedFilename: 'ConstanciaNotifFallo.pdf', stageCode: 'NOTIFICACION_FALLO', responsibleRole: 'escribiente', sortBand: 22 },
  { code: 'remision_corte', labelEs: 'Remisión a la Corte Constitucional', suggestedFilename: 'RemisionCorte.pdf', stageCode: 'REMISION_CORTE', responsibleRole: 'oficial_mayor', sortBand: 30 },
] as const;

const ACT_LABEL_BY_CODE = new Map<string, string>(
  TUTELA_PRIMERA_ACT_TYPES.map((a) => [a.code, a.labelEs]),
);

/** Inferencia para piezas legacy sin `act_code` en BD. */
export function inferActCodeFromDocument(doc: Document): string | null {
  const explicit = doc.actCode?.trim();
  if (explicit) return explicit;
  if (doc.type === 'email_body' || doc.name === 'CorreoReparto' || /^CorreoReparto/i.test(doc.name))
    return 'correo_reparto';
  if (doc.type === 'informe_ingreso_expediente' || /^InformeIngreso/i.test(doc.name)) return 'informe_ingreso';
  if (/^AutoAdmite/i.test(doc.name)) return 'auto_admite';
  if (/^NotificacionAuto/i.test(doc.name)) return 'notificacion_admisorio';
  if (/^ConstanciaNotif/i.test(doc.name) && /Fallo/i.test(doc.name)) return 'constancia_notificacion_fallo';
  if (/^ConstanciaNotif/i.test(doc.name)) return 'constancia_notificacion';
  if (/^Fallo/i.test(doc.name)) return 'fallo_tutela';
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

export function labelForActCode(code: string | null | undefined): string | null {
  if (!code?.trim()) return null;
  return ACT_LABEL_BY_CODE.get(code) ?? null;
}

export function actCatalogForCaseType(caseType: CaseType | null | undefined): readonly CaseActTypeDef[] {
  if (caseType === 'tutela_primera') return TUTELA_PRIMERA_ACT_TYPES;
  return [];
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

/** Actos que el escribiente/secretaría puede elegir al subir manualmente. */
export const UPLOADABLE_ACT_CODES: readonly CaseActCode[] = [
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
  'remision_corte',
];

export function uploadableActsForCaseType(caseType: CaseType | null | undefined): CaseActTypeDef[] {
  const catalog = actCatalogForCaseType(caseType);
  if (catalog.length === 0) return [];
  const allowed = new Set<string>(UPLOADABLE_ACT_CODES);
  return catalog.filter((a) => allowed.has(a.code));
}

export function actRequiresPartyEntity(actCode: string): boolean {
  return actCode === 'respuesta_accionado' || actCode === 'correo_contestacion';
}

/** TitleCase sin espacios para nombres de archivo (protocolo CSJ). */
export function sanitizePartyEntityForFilename(entity: string): string {
  const cleaned = entity
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 28);
  return cleaned || 'Accionado';
}

export function suggestedLogicalNameForAct(
  actCode: string,
  opts?: { partyEntity?: string; originalFilename?: string },
): string {
  const def = TUTELA_PRIMERA_ACT_TYPES.find((a) => a.code === actCode);
  let base = def?.suggestedFilename?.replace(/\.pdf$/i, '') ?? 'Documento';
  if (actCode === 'respuesta_accionado' && opts?.partyEntity?.trim()) {
    base = `Respuesta${sanitizePartyEntityForFilename(opts.partyEntity)}`;
  }
  const ext = opts?.originalFilename?.match(/\.([a-zA-Z0-9]+)$/i)?.[1]?.toLowerCase() ?? 'pdf';
  const safeExt = ext === 'jpeg' || ext === 'jpg' ? 'pdf' : ext;
  return `${base}.${safeExt}`;
}

export function nextActSequenceForDocs(docs: Document[], actCode: string): number {
  const def = TUTELA_PRIMERA_ACT_TYPES.find((a) => a.code === actCode);
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
