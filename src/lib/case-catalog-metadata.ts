/** Metadatos importados desde plataforma/catalogo.db → cases.catalog_metadata */

import type { CaseType } from '../types';
import { isCivilCaseType } from './process-product-scope';
import { stageLabelForCaseType, type CaseStageCode } from './case-workflow-stages';

export type CaseCatalogMetadata = {
  ubicacion_interna?: string;
  regimen?: string;
  confianza_estado?: string;
  tipo_proceso?: string;
  subserie_sgde?: string;
  fuente_estado?: string;
  etapa?: string;
  tramite_pendiente?: string;
  ultimo_auto_fecha?: string;
  ultimo_auto_tipo?: string;
  situacion_plataforma?: string;
  clase?: string;
  subclase?: string;
  tipo_registro?: 'civil' | 'tutela';
  encargado_nombre?: string;
  instancia?: string;
  anio?: number;
  link_expediente?: string;
  /** planner | catalogo | manual */
  link_expediente_fuente?: string;
  planner_deposito?: string;
  planner_estado?: string;
  planner_etiquetas?: string;
  planner_fecha_vencimiento?: string;
  planner_importado_at?: string;
  sgde_url_planner?: string;
};

export function parseCatalogMetadata(raw: unknown): CaseCatalogMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: CaseCatalogMetadata = {};
  const str = (k: keyof CaseCatalogMetadata) => {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim() as never;
  };
  str('ubicacion_interna');
  str('regimen');
  str('confianza_estado');
  str('tipo_proceso');
  str('subserie_sgde');
  str('fuente_estado');
  str('etapa');
  str('tramite_pendiente');
  str('ultimo_auto_fecha');
  str('ultimo_auto_tipo');
  str('situacion_plataforma');
  str('clase');
  str('subclase');
  str('encargado_nombre');
  str('instancia');
  str('link_expediente');
  str('link_expediente_fuente');
  str('planner_deposito');
  str('planner_estado');
  str('planner_etiquetas');
  str('planner_fecha_vencimiento');
  str('planner_importado_at');
  str('sgde_url_planner');
  if (o.tipo_registro === 'civil' || o.tipo_registro === 'tutela') {
    out.tipo_registro = o.tipo_registro;
  }
  if (typeof o.anio === 'number' && Number.isFinite(o.anio)) out.anio = o.anio;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function catalogTipoProcesoVisible(
  meta: CaseCatalogMetadata | undefined,
  subject?: string,
): string {
  const tp = meta?.tipo_proceso?.trim();
  if (tp) return tp;
  const subj = subject?.trim();
  if (subj) return subj;
  const clase = meta?.clase?.trim();
  const subclase = meta?.subclase?.trim();
  if (clase && subclase) return `${clase} / ${subclase}`;
  return clase || subclase || '—';
}

export function catalogSituacionLabel(meta: CaseCatalogMetadata | undefined): string {
  return meta?.situacion_plataforma?.trim() || '—';
}

/** Valores iniciales al radicar un civil en Jurion (lista Procesos civiles). */
export function buildInitialCivilCatalogMetadata(opts: {
  caseType: CaseType;
  stageCode?: CaseStageCode;
  tipoProceso?: string | null;
  clase?: string | null;
  subclase?: string | null;
  encargadoNombre?: string | null;
  anio?: number | null;
}): CaseCatalogMetadata {
  const stage = opts.stageCode ?? 'RADICACION';
  const etapa = stageLabelForCaseType(stage, opts.caseType);
  const out: CaseCatalogMetadata = {
    tipo_registro: 'civil',
    situacion_plataforma: 'activo',
    etapa,
    ubicacion_interna: 'Para ingresar al despacho',
    fuente_estado: 'radicacion_tutelia',
  };
  const tp = opts.tipoProceso?.trim();
  if (tp) out.tipo_proceso = tp;
  const clase = opts.clase?.trim();
  if (clase) out.clase = clase;
  const subclase = opts.subclase?.trim();
  if (subclase) out.subclase = subclase;
  const enc = opts.encargadoNombre?.trim();
  if (enc) out.encargado_nombre = enc;
  if (typeof opts.anio === 'number' && Number.isFinite(opts.anio)) out.anio = opts.anio;
  return out;
}

/** Actualiza etapa/ubicación en metadata existente al cambiar etapa operativa (civil). */
export function patchCivilCatalogMetadataForStage(
  prev: CaseCatalogMetadata | undefined,
  opts: { caseType: CaseType; stageCode: CaseStageCode; ubicacionInterna?: string | null },
): CaseCatalogMetadata | undefined {
  if (!isCivilCaseType(opts.caseType)) return prev;
  const base: CaseCatalogMetadata = {
    ...(prev || {}),
    tipo_registro: 'civil',
    situacion_plataforma: prev?.situacion_plataforma?.trim() || 'activo',
    etapa: stageLabelForCaseType(opts.stageCode, opts.caseType),
    fuente_estado: prev?.fuente_estado?.trim() || 'radicacion_tutelia',
  };
  const ub = opts.ubicacionInterna?.trim();
  if (ub) base.ubicacion_interna = ub;
  else if (!base.ubicacion_interna?.trim()) base.ubicacion_interna = 'Para ingresar al despacho';
  return base;
}
