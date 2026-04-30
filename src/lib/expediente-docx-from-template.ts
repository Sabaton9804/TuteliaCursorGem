import type { Case } from '../types';
import type { PlantillasStateV2 } from './plantillas-store';
import { mapaVariablesDesdeCaso, type MapaVariablesPlantillaContext } from './plantilla-variables';
import { supabase } from './supabase';
import { renderDocxTemplateWithData } from './docx-template-render';

/** Descarga la plantilla del bucket y sustituye marcadores con datos del expediente. */
export async function generarDocxDesdePlantillaAlmacenada(
  storagePath: string,
  caseItem: Case,
  plantillas: PlantillasStateV2,
  plantillaTipo: MapaVariablesPlantillaContext,
): Promise<Blob> {
  const { data, error } = await supabase.storage.from('document-templates').download(storagePath);
  if (error) throw error;
  const buf = await data.arrayBuffer();
  const flat = mapaVariablesDesdeCaso(caseItem, plantillas.membrete, plantillaTipo);
  try {
    return await renderDocxTemplateWithData(buf, flat);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `No se pudo completar la plantilla Word (${msg}). Compruebe que los marcadores coinciden con el catálogo Tutelia.`,
    );
  }
}
