/**
 * Bloque «datos del expediente» del auto admisorio (encima del cuerpo editable).
 * Texto con {{CLAVE}}; se convierte a TipTap al guardar en `autoDatosExpedienteEditorJson`.
 */

import { docToStorage, plainTextToTiptapDoc } from './tiptap-template-storage';

/** Modelo enriquecido (como la vista previa antigua MetaAuto). */
export const DEFAULT_AUTO_DATOS_RICH_PLAIN = [
  'Bogotá D.C. {{FECHA_LETRAS}}',
  'Radicación: {{RADICACION}}',
  'Proceso: Acción de Tutela {{MEDIDA_PROVISIONAL_TITULO}}',
  'Accionante: {{ACCIONANTE}}',
  'Accionado: {{ACCIONADO_PRINCIPAL}}',
].join('\n');

/** Mismo bloque de variables que el prefijo clásico sin membrete rico (compatibilidad). */
export const CLASSIC_AUTO_VARIABLES_PLAIN = [
  '{{FECHA_LETRAS}}',
  'Radicación: {{RADICACION}}',
  'Accionante: {{ACCIONANTE}}',
  'Accionado: {{ACCIONADO_PRINCIPAL}}',
].join('\n');

/** Valor inicial del editor (TipTap serializado con prefijo `tiptap:`). */
export function defaultAutoDatosExpedienteDocStorage(): string {
  return docToStorage(plainTextToTiptapDoc(DEFAULT_AUTO_DATOS_RICH_PLAIN));
}
