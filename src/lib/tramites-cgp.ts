/**
 * Trámite + perfil CGP — civil de circuito, todo el país.
 * El 051 es el piloto (tenant), no el modelo. Overlay de despacho: membrete/oficios.
 * Fuente: docs/cgp/tramites-cgp.json
 */
import type { Case } from '../types';
import type { CaseType } from '../types';
import tramitesCgp from '../data/catalogos/tramites-cgp.json';
import { isCivilCaseType } from './process-product-scope';
import { matchSierjuTipoFromText } from './sierju-process-tipos';

export type CgpPerfil = 'ninguno' | '375' | '376' | '406' | 'hipotecario';

export type CgpTramiteId =
  | 'verbal'
  | 'verbal_pertenencia'
  | 'verbal_servidumbre'
  | 'divisorio'
  | 'ejecutivo';

export type CgpResolveInput = {
  caseType?: CaseType | null;
  sierjuClassCode?: string | null;
  tipoProceso?: string | null;
  clase?: string | null;
};

export type ResolvedCgpTramite = {
  id: CgpTramiteId;
  caseType: CaseType;
  tramite: 'verbal' | 'ejecutivo';
  perfil: CgpPerfil;
  label: string;
};

const SIERJU_CODE_TO_TRAMITE: Record<string, CgpTramiteId> = {
  declarativos_verbal_pertenencia: 'verbal_pertenencia',
  pertenencia: 'verbal_pertenencia',
  declarativos_verbal_servidumbres: 'verbal_servidumbre',
  servidumbres: 'verbal_servidumbre',
  declarativos_especiales_divisorio: 'divisorio',
  declarativos_divisorios: 'divisorio',
  ejecutivos: 'ejecutivo',
  ejecutivos_garantia_real: 'ejecutivo',
  ejecutivos_hipotecario: 'ejecutivo',
};

const LABELS: Record<CgpTramiteId, string> = {
  verbal: 'Verbal (CGP 368 y ss.)',
  verbal_pertenencia: 'Verbal + pertenencia (art. 375)',
  verbal_servidumbre: 'Verbal + servidumbre (art. 376)',
  divisorio: 'Verbal + divisorio (art. 406)',
  ejecutivo: 'Ejecutivo (CGP 422 y ss.)',
};

function perfilOf(id: CgpTramiteId, sierjuCode?: string | null): CgpPerfil {
  if (id === 'verbal_pertenencia') return '375';
  if (id === 'verbal_servidumbre') return '376';
  if (id === 'divisorio') return '406';
  if (id === 'ejecutivo') {
    const c = (sierjuCode || '').toLowerCase();
    if (c.includes('hipotecario') || c.includes('garantia_real')) return 'hipotecario';
    return 'ninguno';
  }
  return 'ninguno';
}

function tramiteKind(id: CgpTramiteId): 'verbal' | 'ejecutivo' {
  return id === 'ejecutivo' ? 'ejecutivo' : 'verbal';
}

function resolved(id: CgpTramiteId, caseType: CaseType, sierjuCode?: string | null): ResolvedCgpTramite {
  const perfil = perfilOf(id, sierjuCode);
  const label =
    id === 'ejecutivo' && perfil === 'hipotecario'
      ? 'Ejecutivo con garantía real / hipotecario'
      : LABELS[id];
  return { id, caseType, tramite: tramiteKind(id), perfil, label };
}

function sierjuCodeFromText(tipoProceso?: string | null, clase?: string | null): string | null {
  const blob = [tipoProceso, clase].filter(Boolean).join(' ');
  if (!blob.trim()) return null;
  return matchSierjuTipoFromText(blob)?.code ?? null;
}

/** Resuelve trámite+perfil. SIERJU informa; el CGP manda el carril. */
export function resolveCgpTramite(input: CgpResolveInput): ResolvedCgpTramite | null {
  const caseType = input.caseType ?? null;
  if (!caseType || !isCivilCaseType(caseType)) return null;

  const fromText = sierjuCodeFromText(input.tipoProceso, input.clase);
  const sierju = (input.sierjuClassCode || fromText || '').trim().toLowerCase();
  const mapped = sierju ? SIERJU_CODE_TO_TRAMITE[sierju] : undefined;

  if (caseType === 'civil_ejecutivo' || mapped === 'ejecutivo') {
    return resolved('ejecutivo', 'civil_ejecutivo', sierju || input.sierjuClassCode);
  }
  if (mapped) {
    return resolved(mapped, caseType, sierju);
  }
  if (caseType === 'civil_ordinario') {
    return resolved('verbal', caseType);
  }
  return {
    id: 'verbal',
    caseType,
    tramite: 'verbal',
    perfil: 'ninguno',
    label: LABELS.verbal,
  };
}

export function cgpOptsFromCase(
  caseItem: Pick<Case, 'caseType' | 'catalogMetadata'> | null | undefined,
): CgpResolveInput {
  return {
    caseType: caseItem?.caseType,
    tipoProceso: caseItem?.catalogMetadata?.tipo_proceso,
    clase: caseItem?.catalogMetadata?.clase,
  };
}

export function tramitesCgpCatalog() {
  return tramitesCgp;
}

/** @deprecated Usar tramitesCgpCatalog */
export function tramites051Catalog() {
  return tramitesCgp;
}

export function requiredActsBeforeStage(
  resolvedTramite: ResolvedCgpTramite | null,
  stageCode: string,
): string[] {
  if (!resolvedTramite) return [];
  const row = tramitesCgp.tramites.find((t) => t.id === resolvedTramite.id);
  if (!row || !('gates' in row) || !Array.isArray(row.gates)) return [];
  return row.gates
    .filter((g) => g.before_stage === stageCode && typeof g.required_act === 'string')
    .map((g) => g.required_act);
}
