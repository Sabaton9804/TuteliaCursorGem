import type { Document } from '../types';

export function isCaseDocumentDocx(d: Pick<Document, 'name' | 'originalName' | 'contentType'>): boolean {
  const n = (d.originalName || d.name || '').toLowerCase();
  if (n.endsWith('.docx') || n.endsWith('.doc')) return true;
  const ct = (d.contentType || '').toLowerCase();
  return (
    ct.includes('wordprocessingml') ||
    ct.includes('application/msword') ||
    ct.includes('officedocument.wordprocessingml')
  );
}

export function isCaseDocumentPdf(d: Pick<Document, 'name' | 'originalName' | 'contentType'>): boolean {
  const n = (d.originalName || d.name || '').toLowerCase();
  if (n.endsWith('.pdf')) return true;
  return (d.contentType || '').toLowerCase().includes('pdf');
}
