import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { JSONContent } from '@tiptap/core';
import type { Case, DocumentTemplateTipo, DocumentTemplateToggleDef } from '../types';
import { buildActiveToggleIds } from './tiptap-template-toggle-filter';
import { formatRadicado } from './formatters';
import { anioEnLetras2000, diaDelMesEnLetras } from './fecha-letras-es';
import type { PlantillasStateV2 } from './plantillas-store';
import {
  aplicarEstiloInformeEncabezadoYFirmaTipTap,
  contenidoBaseToPlainForSubstitution,
  informeTituloFechaPrefijoTiptapDoc,
  isTiptapStorage,
  jsonDocToSubstitutionPlain,
  plainTextToTiptapDoc,
  removeEmptyTextNodesFromTipTapDoc,
  tryParseTipTapDocFromContenidoBase,
} from './tiptap-template-storage';
import { applyToggleFilterToContenidoBase } from './tiptap-template-toggle-filter';
import { renumberJudicialDisponeNumerals } from './auto-dispone-numeracion';
import { stripAutoOptionalNumeralsFromPlainIfNoToggleMarkers } from './auto-optional-plain-strip';
import { CLASSIC_AUTO_VARIABLES_PLAIN, DEFAULT_AUTO_DATOS_RICH_PLAIN } from './auto-datos-expediente-defaults';
import { hasMembreteRichContent } from './membrete-rich-doc';
import { getCachedNameByRole } from './court-staff-cache';
import { DEMO_DESPACHO_STAFF } from './court-staff-demo-seed';
import { userRoleLabelEs } from './user-roles';
import type { UserRole } from '../types';

/** Firma: informe → secretario del equipo; auto → juez del equipo (`DESPACHO_STAFF`). */
export type MapaVariablesPlantillaContext = 'informe_ingreso' | 'auto_admisorio';

export type PlantillaBorradorOpciones = {
  toggleDefs?: DocumentTemplateToggleDef[];
  toggleState?: Record<string, boolean>;
};

/**
 * Sustituye `{{documentMarker}}` y, por compatibilidad, `{{toggleId}}`, por `blockContent` si el toggle está activo.
 * Debe ejecutarse **antes** de `sustituirMarcadores` del caso para que `blockContent` pueda incluir `{{VARIABLES}}`.
 */
export function aplicarMarcadoresToggleEnTexto(
  texto: string,
  defs: DocumentTemplateToggleDef[] | undefined,
  toggleState: Record<string, boolean> | undefined,
): string {
  if (!defs?.length) return texto;
  const active = buildActiveToggleIds(defs, toggleState);

  type Pair = { token: string; defId: string };
  const pairs: Pair[] = [];
  for (const d of defs) {
    const dm = d.documentMarker?.trim();
    if (dm) pairs.push({ token: `{{${dm}}}`, defId: d.id });
    pairs.push({ token: `{{${d.id}}}`, defId: d.id });
  }
  pairs.sort((a, b) => b.token.length - a.token.length);

  let s = texto;
  const seen = new Set<string>();
  for (const { token, defId } of pairs) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (!s.includes(token)) continue;
    const def = defs.find((x) => x.id === defId);
    if (!def) continue;
    const repl = active.has(def.id) ? (def.blockContent ?? '') : '';
    s = s.split(token).join(repl);
  }
  return s;
}

/** Sustituye {{CLAVE}} en texto; claves pueden tener espacios. */
export function sustituirMarcadores(texto: string, mapa: Record<string, string>): string {
  let s = texto;
  const keys = Object.keys(mapa).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const val = mapa[k] ?? '';
    s = s.split(`{{${k}}}`).join(val);
  }
  return s;
}

function nombreEquipoPorRol(role: UserRole): string {
  const cached = getCachedNameByRole(role);
  if (cached) return cached;
  const row = DEMO_DESPACHO_STAFF.find((p) => p.courtRole === role);
  return row?.name?.trim() ?? '';
}

export function mapaVariablesDesdeCaso(
  caseItem: Case,
  membrete: PlantillasStateV2['membrete'],
  /** Define el cargo de firma por defecto en plantillas (informe = secretaría, auto = despacho). */
  plantillaContext?: MapaVariablesPlantillaContext | null,
): Record<string, string> {
  const now = new Date();
  const nombreJuez = nombreEquipoPorRol('judge');
  const nombreSecretario = nombreEquipoPorRol('clerk');
  const rad = formatRadicado(caseItem.radicado) || caseItem.radicado;
  const accionadosLista = caseItem.defendant || '—';
  const primerAccionado =
    caseItem.defendant
      ?.split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean)[0] || caseItem.defendant;

  const fechaCorta = format(now, "d 'de' MMMM 'de' yyyy", { locale: es });
  const mesNombre = format(now, 'MMMM', { locale: es });
  const diaNum = now.getDate();
  const diaPalabra = diaDelMesEnLetras(diaNum);
  const diaTitulado = diaPalabra.charAt(0).toUpperCase() + diaPalabra.slice(1);
  /** Formato tipo acto judicial: «Veintinueve (29) de abril de dos mil veintiséis». */
  const fechaCompletaLetras = `${diaTitulado} (${diaNum}) de ${mesNombre} de ${anioEnLetras2000(now.getFullYear())}`;
  const fechaLetras = `Bogotá D.C., ${fechaCorta}`;

  return {
    FECHA_LETRAS: fechaLetras,
    RADICACION: rad,
    MEDIDA_PROVISIONAL_TITULO: '',
    ACCIONANTE: caseItem.claimant || '—',
    ACCIONADO_PRINCIPAL: primerAccionado || '—',
    DESCRIPCION_DERECHOS: caseItem.legalDerechoTutelado || '—',
    ACCIONANTE_COMPLETO: caseItem.claimantId
      ? `${caseItem.claimant || '—'}, ${caseItem.claimantId}`
      : caseItem.claimant || '—',
    ACCIONADOS_LISTA: accionadosLista,
    ACCIONADOS_NOTIFICAR: accionadosLista,
    RESUMEN_HECHOS_NOTIFICACION: caseItem.legalHechos ? caseItem.legalHechos.slice(0, 400) : '—',
    VINCULADOS_LISTA: '—',
    VINCULADOS_NOTIFICAR: '—',
    NUMERO_SIGUIENTE: '—',
    'BLOQUE MEDIDA PROVISIONAL': '—',
    NUMERO_CORREO: '—',
    NUMERO_PRUEBAS: '—',
    CIUDAD: 'Bogotá, D. C.',
    /** Día en letras + (n) + mes y año en letras (bajo título del informe). */
    FECHA_LETRAS_COMPLETA: fechaCompletaLetras,
    TIPO_PROCESO: 'tutela de primera instancia',
    FINALIDAD_INGRESO: 'para admitir',
    MEDIO_RECEPCION: caseItem.sourceChannel === 'email' ? 'correo electrónico de hoy' : 'medios registrados en expediente',
    /** Nombres del organigrama seed (`court-staff-assignees`); útiles en plantillas con {{NOMBRE_JUEZ}} / {{NOMBRE_SECRETARIO}}. */
    NOMBRE_JUEZ: nombreJuez || '—',
    NOMBRE_SECRETARIO: nombreSecretario || '—',
    FUNCIONARIO_FIRMA:
      plantillaContext === 'informe_ingreso'
        ? nombreSecretario
        : plantillaContext === 'auto_admisorio'
          ? nombreJuez
          : '',
    CARGO_FIRMA:
      plantillaContext === 'auto_admisorio'
        ? userRoleLabelEs('judge')
        : plantillaContext === 'informe_ingreso'
          ? userRoleLabelEs('clerk')
          : '—',
    JUZGADO_NOMBRE: membrete.informe.juzgado,
    DIRECCION_JUZGADO: membrete.informe.direccion,
    CORREO_JUZGADO: membrete.informe.correo,
    MEMBRETE_LINEA1: membrete.auto.line1,
    MEMBRETE_LINEA2: membrete.auto.line2,
    MEMBRETE_LINEA3: membrete.auto.line3,
    JUZGADO_COMPLETO: membrete.informe.juzgado,
  };
}

/** Plantilla interna por defecto (con {{}}). Puede reemplazarse con `contenido_base` en Supabase. */
export function plantillaInformeIngresoInterna(m: PlantillasStateV2): string {
  if (hasMembreteRichContent(m.membrete)) {
    return [
      'INFORME DE INGRESO AL DESPACHO',
      '',
      '{{CIUDAD}}, {{FECHA_LETRAS_COMPLETA}}',
      '',
      'En la fecha ingresa al Despacho del señor juez, {{TIPO_PROCESO}} {{FINALIDAD_INGRESO}}, la cual fue recibida por {{MEDIO_RECEPCION}}.',
      '',
      'Cordialmente,',
      '',
      '{{FUNCIONARIO_FIRMA}}',
      '{{CARGO_FIRMA}}',
    ].join('\n');
  }
  return [
    m.membrete.auto.line1,
    m.membrete.auto.line2,
    m.membrete.informe.juzgado,
    '',
    m.membrete.informe.direccion,
    `Correo: ${m.membrete.informe.correo}`,
    '',
    'INFORME DE INGRESO AL DESPACHO',
    '',
    '{{CIUDAD}}, {{FECHA_LETRAS_COMPLETA}}',
    '',
    'En la fecha ingresa al Despacho del señor juez, {{TIPO_PROCESO}} {{FINALIDAD_INGRESO}}, la cual fue recibida por {{MEDIO_RECEPCION}}.',
    '',
    'Cordialmente,',
    '',
    '{{FUNCIONARIO_FIRMA}}',
    '{{CARGO_FIRMA}}',
  ].join('\n');
}

/** Texto modelo que usa la vista previa cuando aún no hay texto guardado para esa fila del catálogo. */
export function cuerpoPredeterminadoPlantilla(tipo: DocumentTemplateTipo, m: PlantillasStateV2): string {
  if (tipo === 'informe_ingreso') return plantillaInformeIngresoInterna(m);
  if (tipo === 'auto_admisorio') return plantillaAutoAdmisorioInterna(m);
  return '';
}

export function plantillaAutoAdmisorioInterna(m: PlantillasStateV2): string {
  if (hasMembreteRichContent(m.membrete)) {
    return cuerpoEditablePredeterminadoPlantilla('auto_admisorio', m);
  }
  return `${prefijoAutoAntesDelCuerpo(m)}\n${cuerpoEditablePredeterminadoPlantilla('auto_admisorio', m)}`;
}

/** Encabezado y variables de proceso tal como se concatenan al generar el borrador (sin el cuerpo editable). */
/** Texto plano con {{}} del bloque bajo el membrete (fecha, radicación, partes…). */
export function bloqueVariablesAutoAdmisorioPlain(m: PlantillasStateV2): string {
  const raw = m.membrete.autoDatosExpedienteEditorJson?.trim();
  if (raw) {
    const p = contenidoBaseToPlainForSubstitution(raw);
    const t = p?.replace(/\s+$/, '').trim();
    if (t) return t;
  }
  if (hasMembreteRichContent(m.membrete)) return DEFAULT_AUTO_DATOS_RICH_PLAIN;
  return CLASSIC_AUTO_VARIABLES_PLAIN;
}

export function prefijoAutoAntesDelCuerpo(m: PlantillasStateV2): string {
  if (hasMembreteRichContent(m.membrete)) return '';
  return [
    m.membrete.auto.line1,
    m.membrete.auto.line2,
    m.membrete.auto.line3,
    '',
    bloqueVariablesAutoAdmisorioPlain(m),
    '',
  ].join('\n');
}

/** Membrete + título del informe hasta antes del párrafo editable. */
export function prefijoInformeAntesDelCuerpo(m: PlantillasStateV2): string {
  if (hasMembreteRichContent(m.membrete)) return '';
  return [
    m.membrete.auto.line1,
    m.membrete.auto.line2,
    m.membrete.informe.juzgado,
    '',
    m.membrete.informe.direccion,
    `Correo: ${m.membrete.informe.correo}`,
    '',
    'INFORME DE INGRESO AL DESPACHO',
    '',
    '{{CIUDAD}}, {{FECHA_LETRAS_COMPLETA}}',
    '',
  ].join('\n');
}

/**
 * Solo el bloque que el admin edita en Plantillas (sin repetir membrete ni encabezado fijo).
 * En BD suele guardarse solo esto; al generar el Word se antepone `prefijo*AntesDelCuerpo`.
 */
export function cuerpoEditablePredeterminadoPlantilla(tipo: DocumentTemplateTipo, _m: PlantillasStateV2): string {
  if (tipo === 'informe_ingreso') {
    return [
      'En la fecha ingresa al Despacho del señor juez, {{TIPO_PROCESO}} {{FINALIDAD_INGRESO}}, la cual fue recibida por {{MEDIO_RECEPCION}}.',
      '',
      'Cordialmente,',
      '',
      '{{FUNCIONARIO_FIRMA}}',
      '{{CARGO_FIRMA}}',
    ].join('\n');
  }
  if (tipo === 'auto_admisorio') {
    return [
      `La acción de tutela para la protección de {{DESCRIPCION_DERECHOS}} (Decreto 2591 de 1991).`,
      '',
      'DISPONE:',
      '',
      '1. ADMITIR la acción presentada por {{ACCIONANTE_COMPLETO}} contra {{ACCIONADOS_LISTA}}.',
      '2. NOTIFÍQUESE a {{ACCIONADOS_NOTIFICAR}} el término de dos (2) días para responder, sobre {{RESUMEN_HECHOS_NOTIFICACION}}.',
      '{{BLOQUE_VINCULADOS}}',
      '{{BLOQUE_MEDIDA_PROVISIONAL}}',
      '',
      'COMUNÍQUESE Y CÚMPLASE.',
    ].join('\n');
  }
  return '';
}

/** Texto fijo del párrafo inicial del cuerpo (plantilla informe y Word generado). */
export const MARCA_CUERPO_INFORME = 'En la fecha ingresa al Despacho del señor juez';
const MARCA_CUERPO_AUTO = 'La acción de tutela para la protección de';

/** Título + línea de ciudad/fecha (marcadores) cuando el editor solo guarda el cuerpo desde «En la fecha…». */
function prefijoTituloYFechaInformeVariablesPlain(): string {
  return ['INFORME DE INGRESO AL DESPACHO', '', '{{CIUDAD}}, {{FECHA_LETRAS_COMPLETA}}', ''].join('\n');
}

/**
 * Valor para el editor TipTap: si en BD hay plantilla completa antigua, devuelve solo el cuerpo editable.
 */
export function contenidoParaEditorPlantillas(
  contenidoBase: string | null | undefined,
  tipo: DocumentTemplateTipo,
  m: PlantillasStateV2,
): string {
  const raw = contenidoBase?.trim();
  if (!raw) {
    return cuerpoEditablePredeterminadoPlantilla(tipo, m);
  }
  if (tipo === 'libre') return raw;
  /** Contenido enriquecido guardado como `tiptap:{...}`: no convertir a plano (se perderían alineación, negritas, tablas). */
  if (isTiptapStorage(raw)) return raw;
  const plain = contenidoBaseToPlainForSubstitution(raw) ?? '';
  const line1 = m.membrete.auto.line1.trim();
  if (tipo === 'informe_ingreso') {
    if (hasMembreteRichContent(m.membrete)) {
      const idx = plain.indexOf(MARCA_CUERPO_INFORME);
      if (idx >= 0) return plain.slice(idx).trim();
      return plain;
    }
    if (line1 && plain.trimStart().startsWith(line1)) {
      const idx = plain.indexOf(MARCA_CUERPO_INFORME);
      if (idx >= 0) return plain.slice(idx).trim();
    }
    return plain;
  }
  if (tipo === 'auto_admisorio') {
    if (hasMembreteRichContent(m.membrete)) {
      const idx = plain.indexOf(MARCA_CUERPO_AUTO);
      if (idx >= 0) return plain.slice(idx).trim();
      return plain;
    }
    if (line1 && plain.trimStart().startsWith(line1)) {
      const idx = plain.indexOf(MARCA_CUERPO_AUTO);
      if (idx >= 0) return plain.slice(idx).trim();
    }
    return plain;
  }
  return plain;
}

export function textoInformeIngresoBorrador(
  caseItem: Case,
  m: PlantillasStateV2,
  contenidoBaseOverride?: string | null,
  opciones?: PlantillaBorradorOpciones,
): string {
  const v = mapaVariablesDesdeCaso(caseItem, m.membrete, 'informe_ingreso');
  let base = contenidoBaseOverride;
  if (opciones?.toggleDefs?.length) {
    base = applyToggleFilterToContenidoBase(base, opciones.toggleDefs, opciones.toggleState) ?? base;
  }
  const desdeBd = contenidoBaseToPlainForSubstitution(base ?? undefined);
  const defs = opciones?.toggleDefs;
  const st = opciones?.toggleState;

  if (!desdeBd?.trim()) {
    let out = plantillaInformeIngresoInterna(m);
    out = aplicarMarcadoresToggleEnTexto(out, defs, st);
    return sustituirMarcadores(out, v);
  }
  const trimmed = desdeBd.trim();
  const line1 = m.membrete.auto.line1.trim();
  const encabezadoInformeEnCuerpo = /INFORME DE INGRESO AL DESPACHO/i.test(trimmed);
  let plantilla = hasMembreteRichContent(m.membrete)
    ? encabezadoInformeEnCuerpo
      ? trimmed
      : `${prefijoTituloYFechaInformeVariablesPlain()}${trimmed}`
    : line1 && trimmed.startsWith(line1)
      ? trimmed
      : `${prefijoInformeAntesDelCuerpo(m)}\n${trimmed}`;
  plantilla = aplicarMarcadoresToggleEnTexto(plantilla, defs, st);
  return sustituirMarcadores(plantilla, v);
}

function sustituirMarcadoresEnTiptapDoc(doc: JSONContent, mapa: Record<string, string>): JSONContent {
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === 'text' && typeof node.text === 'string') {
      return { ...node, text: sustituirMarcadores(node.text, mapa) };
    }
    if (node.type === 'expedienteVariable') {
      const key = String(node.attrs?.key ?? '').trim();
      return { type: 'text', text: mapa[key] ?? '', marks: node.marks };
    }
    if (!node.content?.length) return { ...node };
    return { ...node, content: node.content.map(walk) };
  };
  return removeEmptyTextNodesFromTipTapDoc(walk(doc));
}

function aplicarMarcadoresToggleEnTiptapDoc(
  doc: JSONContent,
  defs: DocumentTemplateToggleDef[] | undefined,
  state: Record<string, boolean> | undefined,
): JSONContent {
  if (!defs?.length) return doc;
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === 'text' && typeof node.text === 'string') {
      return { ...node, text: aplicarMarcadoresToggleEnTexto(node.text, defs, state) };
    }
    if (!node.content?.length) return { ...node };
    return { ...node, content: node.content.map(walk) };
  };
  return walk(doc);
}

/**
 * Borrador informe como documento TipTap ya sustituido (para `buildJudicialDocxBlob`).
 * `null` si el contenido en BD no es JSON TipTap o está vacío (usar `textoInformeIngresoBorrador` en texto plano).
 */
export function textoInformeIngresoBorradorTipTapDoc(
  caseItem: Case,
  m: PlantillasStateV2,
  contenidoBaseOverride?: string | null,
  opciones?: PlantillaBorradorOpciones,
): JSONContent | null {
  let base = contenidoBaseOverride;
  if (opciones?.toggleDefs?.length) {
    base = applyToggleFilterToContenidoBase(base, opciones.toggleDefs, opciones.toggleState) ?? base;
  }
  const docFromBd = tryParseTipTapDocFromContenidoBase(base ?? undefined);
  if (!docFromBd) return null;

  const plainCheck = jsonDocToSubstitutionPlain(docFromBd).replace(/\n+$/, '').trim();
  if (!plainCheck) return null;

  const v = mapaVariablesDesdeCaso(caseItem, m.membrete, 'informe_ingreso');
  const defs = opciones?.toggleDefs;
  const st = opciones?.toggleState;

  let merged: JSONContent = docFromBd;
  if (hasMembreteRichContent(m.membrete)) {
    const encabezado = /INFORME DE INGRESO AL DESPACHO/i.test(plainCheck);
    if (!encabezado) {
      const pref = informeTituloFechaPrefijoTiptapDoc();
      merged = { type: 'doc', content: [...(pref.content ?? []), ...(docFromBd.content ?? [])] };
    }
  } else {
    const line1 = m.membrete.auto.line1.trim();
    if (line1 && plainCheck.startsWith(line1)) {
      merged = docFromBd;
    } else {
      const pref = plainTextToTiptapDoc(prefijoInformeAntesDelCuerpo(m));
      merged = { type: 'doc', content: [...(pref.content ?? []), ...(docFromBd.content ?? [])] };
    }
  }

  let out = aplicarMarcadoresToggleEnTiptapDoc(merged, defs, st);
  out = sustituirMarcadoresEnTiptapDoc(out, v);
  out = aplicarEstiloInformeEncabezadoYFirmaTipTap(out);
  return removeEmptyTextNodesFromTipTapDoc(out);
}

/**
 * Borrador auto como documento TipTap ya sustituido (para `buildJudicialDocxBlob`).
 * `null` si el contenido en BD no es JSON TipTap o está vacío.
 */
export function textoAutoAdmisorioBorradorTipTapDoc(
  caseItem: Case,
  m: PlantillasStateV2,
  contenidoBaseOverride?: string | null,
  opciones?: PlantillaBorradorOpciones,
): JSONContent | null {
  let base = contenidoBaseOverride;
  if (opciones?.toggleDefs?.length) {
    base = applyToggleFilterToContenidoBase(base, opciones.toggleDefs, opciones.toggleState) ?? base;
  }
  const docFromBd = tryParseTipTapDocFromContenidoBase(base ?? undefined);
  if (!docFromBd) return null;

  const plainCheck = jsonDocToSubstitutionPlain(docFromBd).replace(/\n+$/, '').trim();
  if (!plainCheck) return null;

  const v = mapaVariablesDesdeCaso(caseItem, m.membrete, 'auto_admisorio');
  const defs = opciones?.toggleDefs;
  const st = opciones?.toggleState;

  let merged: JSONContent = docFromBd;
  if (hasMembreteRichContent(m.membrete)) {
    const bloque = bloqueVariablesAutoAdmisorioPlain(m).trim();
    if (bloque) {
      const pref = plainTextToTiptapDoc(`${bloque}\n\n`);
      merged = { type: 'doc', content: [...(pref.content ?? []), ...(docFromBd.content ?? [])] };
    }
  } else {
    const line1 = m.membrete.auto.line1.trim();
    if (line1 && plainCheck.startsWith(line1)) {
      merged = docFromBd;
    } else {
      const pref = plainTextToTiptapDoc(prefijoAutoAntesDelCuerpo(m));
      merged = { type: 'doc', content: [...(pref.content ?? []), ...(docFromBd.content ?? [])] };
    }
  }

  let out = aplicarMarcadoresToggleEnTiptapDoc(merged, defs, st);
  out = sustituirMarcadoresEnTiptapDoc(out, v);
  return removeEmptyTextNodesFromTipTapDoc(out);
}

export function textoAutoAdmisorioBorrador(
  caseItem: Case,
  m: PlantillasStateV2,
  contenidoBaseOverride?: string | null,
  opciones?: PlantillaBorradorOpciones,
): string {
  const v = mapaVariablesDesdeCaso(caseItem, m.membrete, 'auto_admisorio');
  let base = contenidoBaseOverride;
  if (opciones?.toggleDefs?.length) {
    base = applyToggleFilterToContenidoBase(base, opciones.toggleDefs, opciones.toggleState) ?? base;
  }
  const desdeBd = contenidoBaseToPlainForSubstitution(base ?? undefined);
  const defs = opciones?.toggleDefs;
  const st = opciones?.toggleState;
  const fin = (s: string) =>
    renumberJudicialDisponeNumerals(stripAutoOptionalNumeralsFromPlainIfNoToggleMarkers(s, defs, st));

  if (!desdeBd?.trim()) {
    let out = plantillaAutoAdmisorioInterna(m);
    if (hasMembreteRichContent(m.membrete)) {
      const bloque = bloqueVariablesAutoAdmisorioPlain(m).trim();
      if (bloque) out = `${bloque}\n\n${out}`;
    }
    out = aplicarMarcadoresToggleEnTexto(out, defs, st);
    return fin(sustituirMarcadores(out, v));
  }
  const trimmed = desdeBd.trim();
  const line1 = m.membrete.auto.line1.trim();
  let plantilla: string;
  if (hasMembreteRichContent(m.membrete)) {
    const bloque = bloqueVariablesAutoAdmisorioPlain(m).trim();
    plantilla = bloque ? `${bloque}\n\n${trimmed}` : trimmed;
  } else if (line1 && trimmed.startsWith(line1)) {
    plantilla = trimmed;
  } else {
    plantilla = `${prefijoAutoAntesDelCuerpo(m)}\n${trimmed}`;
  }
  plantilla = aplicarMarcadoresToggleEnTexto(plantilla, defs, st);
  return fin(sustituirMarcadores(plantilla, v));
}

export function descargarTxt(nombreArchivo: string, contenido: string) {
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(a.href);
}
