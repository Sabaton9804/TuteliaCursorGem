import type { DocumentTemplateTipo } from '../types';

/** Grupo para el menú desplegable (orden de visualización). */
export type GrupoMarcador = 'partes' | 'fechas' | 'proceso' | 'juzgado' | 'otros';

const GRUPO_LABEL: Record<GrupoMarcador, string> = {
  partes: 'Partes y personas',
  fechas: 'Fechas',
  proceso: 'Proceso y despacho',
  juzgado: 'Juzgado y membrete',
  otros: 'Otros datos',
};

const ORDEN_GRUPO: GrupoMarcador[] = ['partes', 'fechas', 'proceso', 'juzgado', 'otros'];

export type MarcadorCatalogoItem = {
  /** Clave interna sin llaves, ej. RADICACION */
  clave: string;
  /** Lo que ve el abogado en el menú */
  etiqueta: string;
  grupo: GrupoMarcador;
  /** Ayuda corta en tooltip */
  ayuda?: string;
  /** Si solo aplica a ciertos tipos de plantilla; omitido = todos */
  soloTipo?: 'informe_ingreso' | 'auto_admisorio';
};

/** Catálogo completo: una sola fuente para menús y listas de ayuda. */
export const MARCADORES_CATALOGO: MarcadorCatalogoItem[] = [
  // Partes
  {
    clave: 'ACCIONANTE',
    etiqueta: 'Accionante (quien interpone)',
    grupo: 'partes',
    ayuda: 'Nombre del accionante en encabezados',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'ACCIONADO_PRINCIPAL',
    etiqueta: 'Accionado principal',
    grupo: 'partes',
    ayuda: 'Principal demandado / accionado',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'ACCIONANTE_COMPLETO',
    etiqueta: 'Accionante con datos completos',
    grupo: 'partes',
    ayuda: 'Nombre e identificación si aplica',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'ACCIONADOS_LISTA',
    etiqueta: 'Lista de accionados',
    grupo: 'partes',
    ayuda: 'Para admisión y numerales',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'ACCIONADOS_NOTIFICAR',
    etiqueta: 'Quienes deben ser notificados',
    grupo: 'partes',
    ayuda: 'Traslado y notificación',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'VINCULADOS_LISTA',
    etiqueta: 'Terceros vinculados',
    grupo: 'partes',
    ayuda: 'Opcional — vinculación',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'VINCULADOS_NOTIFICAR',
    etiqueta: 'Notificación a vinculados',
    grupo: 'partes',
    ayuda: 'Opcional',
    soloTipo: 'auto_admisorio',
  },

  // Fechas
  {
    clave: 'FECHA_LETRAS',
    etiqueta: 'Fecha del auto (ciudad y día en letras)',
    grupo: 'fechas',
    ayuda: 'Típico al inicio del auto',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'FECHA_LETRAS_COMPLETA',
    etiqueta: 'Fecha completa en letras',
    grupo: 'fechas',
    ayuda: 'Día en letras + día en dígitos entre paréntesis + mes y año en palabras, p. ej. «Veintinueve (29) de abril de dos mil veintiséis».',
    soloTipo: 'informe_ingreso',
  },
  {
    clave: 'CIUDAD',
    etiqueta: 'Ciudad',
    grupo: 'fechas',
    ayuda: 'Ej. Bogotá, D. C.',
    soloTipo: 'informe_ingreso',
  },

  // Proceso
  {
    clave: 'RADICACION',
    etiqueta: 'Número de radicación',
    grupo: 'proceso',
    ayuda: 'Formato completo del proceso',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'DESCRIPCION_DERECHOS',
    etiqueta: 'Derechos que se protegen',
    grupo: 'proceso',
    ayuda: 'Fundamentos tutela — derechos fundamentales',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'MEDIDA_PROVISIONAL_TITULO',
    etiqueta: 'Título de medida provisional',
    grupo: 'proceso',
    ayuda: 'Si aplica cautela / medida',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'BLOQUE MEDIDA PROVISIONAL',
    etiqueta: 'Texto de medida provisional / cautelar',
    grupo: 'proceso',
    ayuda: 'Bloque largo opcional',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'RESUMEN_HECHOS_NOTIFICACION',
    etiqueta: 'Resumen de hechos para notificación',
    grupo: 'proceso',
    ayuda: 'Plazo de respuesta',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'TIPO_PROCESO',
    etiqueta: 'Tipo de proceso',
    grupo: 'proceso',
    ayuda: 'Ej. tutela de primera instancia',
    soloTipo: 'informe_ingreso',
  },
  {
    clave: 'FINALIDAD_INGRESO',
    etiqueta: 'Finalidad del ingreso',
    grupo: 'proceso',
    ayuda: 'Ej. para admitir',
    soloTipo: 'informe_ingreso',
  },
  {
    clave: 'MEDIO_RECEPCION',
    etiqueta: 'Cómo ingresó el proceso',
    grupo: 'proceso',
    ayuda: 'Ej. correo electrónico',
    soloTipo: 'informe_ingreso',
  },
  {
    clave: 'FUNCIONARIO_FIRMA',
    etiqueta: 'Quién firma (nombre)',
    grupo: 'proceso',
    ayuda: 'En informe: secretario(a) del equipo; en auto: juez del equipo (organigrama de la app).',
  },
  {
    clave: 'CARGO_FIRMA',
    etiqueta: 'Cargo de quien firma',
    grupo: 'proceso',
    ayuda: 'En informe: «Secretario(a)»; en auto: «Juez» (etiqueta corta). Combine con {{FUNCIONARIO_FIRMA}}.',
  },
  {
    clave: 'NOMBRE_JUEZ',
    etiqueta: 'Nombre del juez (equipo)',
    grupo: 'juzgado',
    ayuda: 'Nombre del titular según el organigrama configurado.',
  },
  {
    clave: 'NOMBRE_SECRETARIO',
    etiqueta: 'Nombre del secretario(a) (equipo)',
    grupo: 'juzgado',
    ayuda: 'Secretario(a) de la lista de equipo de trabajo.',
  },
  {
    clave: 'NUMERO_SIGUIENTE',
    etiqueta: 'Siguiente número de apartado',
    grupo: 'proceso',
    ayuda: 'Numeración dinámica',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'NUMERO_CORREO',
    etiqueta: 'Apartado sobre correo electrónico',
    grupo: 'proceso',
    ayuda: 'Comunicaciones oficiales',
    soloTipo: 'auto_admisorio',
  },
  {
    clave: 'NUMERO_PRUEBAS',
    etiqueta: 'Apartado sobre pruebas',
    grupo: 'proceso',
    ayuda: 'Recepción de pruebas',
    soloTipo: 'auto_admisorio',
  },

  // Juzgado / membrete (útiles en cualquier texto largo)
  {
    clave: 'MEMBRETE_LINEA1',
    etiqueta: 'Membrete — línea 1',
    grupo: 'juzgado',
    ayuda: 'Primera línea institucional',
  },
  {
    clave: 'MEMBRETE_LINEA2',
    etiqueta: 'Membrete — línea 2',
    grupo: 'juzgado',
  },
  {
    clave: 'MEMBRETE_LINEA3',
    etiqueta: 'Membrete — línea 3',
    grupo: 'juzgado',
  },
  {
    clave: 'JUZGADO_COMPLETO',
    etiqueta: 'Nombre completo del juzgado',
    grupo: 'juzgado',
  },
  {
    clave: 'JUZGADO_NOMBRE',
    etiqueta: 'Nombre del juzgado (informe)',
    grupo: 'juzgado',
  },
  {
    clave: 'DIRECCION_JUZGADO',
    etiqueta: 'Dirección del juzgado',
    grupo: 'juzgado',
  },
  {
    clave: 'CORREO_JUZGADO',
    etiqueta: 'Correo del juzgado',
    grupo: 'juzgado',
  },
];

export function etiquetaGrupo(g: GrupoMarcador): string {
  return GRUPO_LABEL[g];
}

export function marcadadorFormateado(clave: string): string {
  return `{{${clave}}}`;
}

/** Lista filtrada según tipo de plantilla; «libre» incluye todo. */
function ordenarMarcadores(items: MarcadorCatalogoItem[]): MarcadorCatalogoItem[] {
  return [...items].sort((a, b) => {
    const ia = ORDEN_GRUPO.indexOf(a.grupo);
    const ib = ORDEN_GRUPO.indexOf(b.grupo);
    if (ia !== ib) return ia - ib;
    return a.etiqueta.localeCompare(b.etiqueta, 'es');
  });
}

export function marcadoresParaPlantilla(tipo: DocumentTemplateTipo): MarcadorCatalogoItem[] {
  if (tipo === 'libre') {
    return ordenarMarcadores(MARCADORES_CATALOGO);
  }
  return ordenarMarcadores(MARCADORES_CATALOGO.filter((m) => !m.soloTipo || m.soloTipo === tipo));
}

/** Para las listas colapsables en la página Plantillas (compatibilidad). */
export function listaVariablesAuto(): { name: string; desc: string }[] {
  return marcadoresParaPlantilla('auto_admisorio').map((m) => ({
    name: m.clave,
    desc: m.ayuda ?? m.etiqueta,
  }));
}

export function listaVariablesInforme(): { name: string; desc: string }[] {
  return marcadoresParaPlantilla('informe_ingreso').map((m) => ({
    name: m.clave,
    desc: m.ayuda ?? m.etiqueta,
  }));
}

/** Líneas para el prompt de IA (servidor): una clave permitida por línea. */
export function catalogoTextoParaPromptIA(tipo: DocumentTemplateTipo): string {
  return marcadoresParaPlantilla(tipo)
    .map((m) => `- ${m.clave}: ${m.etiqueta}${m.ayuda ? ` (${m.ayuda})` : ''}`)
    .join('\n');
}

export function clavesMarcadoresValidas(tipo: DocumentTemplateTipo): string[] {
  return marcadoresParaPlantilla(tipo).map((m) => m.clave);
}

export function descripcionMarcadorPorClave(clave: string): string {
  const m = MARCADORES_CATALOGO.find((x) => x.clave === clave);
  if (m) return m.ayuda ? `${m.etiqueta} — ${m.ayuda}` : m.etiqueta;
  return clave;
}

/** Etiqueta legible para pastillas en editor / vista previa (misma que inserta el menú). */
export function etiquetaMarcadorPorClave(clave: string): string {
  const m = MARCADORES_CATALOGO.find((x) => x.clave === clave);
  return m?.etiqueta ?? clave;
}
