import { supabase } from './supabase';
import { CASE_DOCUMENTS_BUCKET } from './case-document-storage';

function safeDocxFilename(name: string): string {
  const t = (name || '').trim() || 'documento.docx';
  const noPath = t.replace(/[/\\]+/g, '_').replace(/\s+/g, ' ').slice(0, 180);
  return /\.docx$/i.test(noPath) ? noPath : `${noPath.replace(/\.[^/.]+$/, '')}.docx`;
}

/** Descarga el .docx desde Storage (blob); el nombre respeta la extensión .docx. */
export async function downloadCaseDocxFromStoragePath(storagePath: string, filename: string): Promise<void> {
  const path = storagePath.trim();
  if (!path) throw new Error('Sin ruta de almacenamiento del documento.');
  const { data, error } = await supabase.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message || 'No se pudo descargar el documento.');
  const dl = safeDocxFilename(filename);
  const url = URL.createObjectURL(data);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = dl;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
  }
}
