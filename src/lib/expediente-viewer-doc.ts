import type { Document } from '../types';
import { inferActCodeFromDocument, labelForActCode } from './case-act-types';

/** Pieza con archivo en Storage, contenido en fila o registro de fallo de ingreso. */
export function isExpedientePiezaListable(doc: Document | null | undefined): boolean {
  if (!doc) return false;
  if (doc.ingestError) return true;
  return Boolean(doc.storagePath?.trim() || (doc.content && doc.content.length > 0));
}

/** Se puede abrir en el visor (PDF, Word, imagen, etc.). */
export function isCaseDocumentOpenableInViewer(doc: Document | null | undefined): boolean {
  if (!doc) return false;
  return Boolean(doc.storagePath?.trim() || (doc.content && doc.content.length > 0));
}

/** Piezas visibles en el listado del expediente digital. */
export function expedientePiezasParaLista(docs: Document[]): Document[] {
  return docs.filter(isExpedientePiezaListable);
}

/** Orden de apertura: primero demanda/anexos, luego constancia de correo. */
export function primeraPiezaParaAbrir(docs: Document[]): Document | null {
  const list = expedientePiezasParaLista(docs);
  if (list.length === 0) return null;
  const demanda = list.find((d) => d.type !== 'email_body' && isCaseDocumentOpenableInViewer(d));
  return demanda ?? list.find(isCaseDocumentOpenableInViewer) ?? null;
}

export function esConstanciaCorreoReparto(doc: Document | null | undefined): boolean {
  if (!doc) return false;
  return doc.type === 'email_body' || doc.name === 'CorreoReparto';
}

export function tituloPiezaExpediente(doc: Document | null | undefined): string | null {
  if (!doc) return null;
  const actLabel = labelForActCode(inferActCodeFromDocument(doc));
  if (actLabel) return actLabel;
  if (esConstanciaCorreoReparto(doc)) return 'Constancia de ingreso (correo reparto)';
  return null;
}
