/** Metadatos importados desde plataforma/catalogo.db → cases.catalog_metadata */

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
