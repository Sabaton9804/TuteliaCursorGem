import type { DocumentTemplateTipo } from '../types';
import catalogRaw from '../data/catalogos/tipos-oficio-secretaria.json';

export type OficioSecretariaTipoId =
  | 'oficio_juzgado'
  | 'oficio_comision'
  | 'oficio_requerimiento'
  | 'oficio_competencia';

export type OficioSecretariaTipoDef = {
  id: OficioSecretariaTipoId;
  nombre_visible: string;
  descripcion: string;
  cuerpo: string;
};

const TIPOS: OficioSecretariaTipoDef[] = (
  catalogRaw as { tipos?: OficioSecretariaTipoDef[] }
).tipos?.filter((t) => t.id && t.cuerpo) ?? [];

export const OFICIO_SECRETARIA_TIPOS = TIPOS;

export function isOficioSecretariaTipo(tipo: DocumentTemplateTipo): tipo is OficioSecretariaTipoId {
  return TIPOS.some((t) => t.id === tipo);
}

export function oficioSecretariaDef(tipo: OficioSecretariaTipoId): OficioSecretariaTipoDef | undefined {
  return TIPOS.find((t) => t.id === tipo);
}

/** Nombre de archivo PDF sugerido (protocolo CSJ TitleCase). */
export function suggestedPdfNameForOficioSecretaria(tipo: OficioSecretariaTipoId): string {
  const map: Record<OficioSecretariaTipoId, string> = {
    oficio_juzgado: 'OficioJuzgado.pdf',
    oficio_comision: 'OficioComision.pdf',
    oficio_requerimiento: 'OficioRequerimiento.pdf',
    oficio_competencia: 'OficioCompetencia.pdf',
  };
  return map[tipo];
}
