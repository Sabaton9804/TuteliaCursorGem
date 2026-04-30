import type { Document } from '../types';

/**
 * Etiqueta “cruda” para listado y visor: prioriza `name` (radicación, parseo con
 * `getUniqueName`, renombre manual) y solo si falta usa `originalName` (adjunto MIME).
 */
export function caseDocumentRawLabel(doc: Pick<Document, 'name' | 'originalName'>): string {
  const n = (doc.name || '').trim();
  if (n) return n;
  return (doc.originalName || '').trim();
}
