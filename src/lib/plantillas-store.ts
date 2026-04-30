import { DEFAULT_PLANTILLAS as V1_DEFAULT, type PlantillasStateV1 } from './plantillas-store-v1-shim';

export type { PlantillasStateV1 };

/** Tipos de catálogo (persistidos en Supabase `document_templates`). */
export type PlantillaCategoria = 'despacho' | 'secretaria';

export type PlantillaTipo = 'informe_ingreso' | 'auto_admisorio' | 'libre';

export interface PlantillasMembrete {
  auto: {
    line1: string;
    line2: string;
    line3: string;
  };
  informe: {
    juzgado: string;
    direccion: string;
    correo: string;
  };
  membreteImageDataUrl: string;
  /**
   * Documento TipTap (JSON stringificado) para el membrete visual libre.
   * Vacío o ausente: la vista previa se arma desde `auto` / `informe` / imagen clásica.
   */
  membreteEditorJson?: string;
  /**
   * Bloque editable (TipTap con prefijo `tiptap:`) con fecha, radicación, proceso, partes, etc.
   * Por despacho; se antepone al cuerpo del auto admisorio al generar el documento.
   */
  autoDatosExpedienteEditorJson?: string;
}

/** Solo membrete en localStorage; el catálogo vive en Supabase. */
export interface PlantillasStateV2 {
  version: 3;
  membrete: PlantillasMembrete;
}

const STORAGE_KEY = 'tutelia_plantillas_v1';

export function defaultPlantillasV2(): PlantillasStateV2 {
  return {
    version: 3,
    membrete: {
      auto: { ...V1_DEFAULT.auto },
      informe: { ...V1_DEFAULT.informe },
      membreteImageDataUrl: '',
      membreteEditorJson: '',
      autoDatosExpedienteEditorJson: '',
    },
  };
}

function parseMembreteFromUnknown(m: unknown): PlantillasMembrete | null {
  if (!m || typeof m !== 'object') return null;
  const x = m as Partial<PlantillasMembrete>;
  const auto = x.auto;
  const inf = x.informe;
  if (!auto || !inf) return null;
  return {
    auto: {
      line1: typeof auto.line1 === 'string' ? auto.line1 : V1_DEFAULT.auto.line1,
      line2: typeof auto.line2 === 'string' ? auto.line2 : V1_DEFAULT.auto.line2,
      line3: typeof auto.line3 === 'string' ? auto.line3 : V1_DEFAULT.auto.line3,
    },
    informe: {
      juzgado: typeof inf.juzgado === 'string' ? inf.juzgado : V1_DEFAULT.informe.juzgado,
      direccion: typeof inf.direccion === 'string' ? inf.direccion : V1_DEFAULT.informe.direccion,
      correo: typeof inf.correo === 'string' ? inf.correo : V1_DEFAULT.informe.correo,
    },
    membreteImageDataUrl: typeof x.membreteImageDataUrl === 'string' ? x.membreteImageDataUrl : '',
    membreteEditorJson: typeof x.membreteEditorJson === 'string' ? x.membreteEditorJson : '',
    autoDatosExpedienteEditorJson:
      typeof x.autoDatosExpedienteEditorJson === 'string' ? x.autoDatosExpedienteEditorJson : '',
  };
}

export function loadPlantillas(): PlantillasStateV2 {
  if (typeof localStorage === 'undefined') return defaultPlantillasV2();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPlantillasV2();
    const o = JSON.parse(raw) as Record<string, unknown>;
    const ver = o.version;

    const v1 = o as Partial<PlantillasStateV1>;
    if (ver === 1 && v1.auto && v1.informe) {
      const next: PlantillasStateV2 = {
        version: 3,
        membrete: {
          auto: { ...(v1.auto as PlantillasMembrete['auto']) },
          informe: { ...(v1.informe as PlantillasMembrete['informe']) },
          membreteImageDataUrl: typeof v1.membreteImageDataUrl === 'string' ? v1.membreteImageDataUrl : '',
          membreteEditorJson: '',
          autoDatosExpedienteEditorJson: '',
        },
      };
      savePlantillas(next);
      return next;
    }

    const mem = parseMembreteFromUnknown(o.membrete);
    if (mem) {
      const next: PlantillasStateV2 = { version: 3, membrete: mem };
      if (ver !== 3) savePlantillas(next);
      return next;
    }
  } catch {
    /* fallthrough */
  }
  return defaultPlantillasV2();
}

export function savePlantillas(state: PlantillasStateV2): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('No se pudo guardar plantillas (cuota o privado)', e);
  }
}

const MAX_IMAGE_BYTES = 1_200_000;

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Seleccione un archivo de imagen (PNG, JPEG, etc.).'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('La imagen supera 1,2 MB. Comprima o reduzca el tamaño.'));
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const s = r.result;
      if (typeof s === 'string') resolve(s);
      else reject(new Error('No se pudo leer la imagen.'));
    };
    r.onerror = () => reject(new Error('Error al leer el archivo.'));
    r.readAsDataURL(file);
  });
}

export { DEFAULT_PLANTILLAS } from './plantillas-store-v1-shim';
