import { supabase } from './supabase';
import type {
  Document,
  DocumentTemplate,
  DocumentTemplateCategoria,
  DocumentTemplatePageLayout,
  DocumentTemplateTipo,
  DocumentTemplateToggleDef,
} from '../types';
import { mergePageLayout } from './document-template-page-layout';
import { insertCaseDocumentRowReturningId, uploadCaseAttachment } from './case-document-storage';
import { DEFAULT_NOTEBOOK_CODE } from './expediente-notebook';
import { nextSortOrderInPrincipalNotebook } from './expediente-document-order';
import { ensureSupabaseSessionForWrites } from './supabase-write-auth';
import { userFacingSupabaseError } from './supabase-user-error';

function parseToggleDefs(raw: unknown): DocumentTemplateToggleDef[] {
  if (!Array.isArray(raw)) return [];
  const out: DocumentTemplateToggleDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : '';
    if (!id) continue;
    const dm =
      typeof (o as { documentMarker?: unknown }).documentMarker === 'string'
        ? String((o as { documentMarker: string }).documentMarker).trim()
        : '';
    out.push({
      id,
      label: typeof o.label === 'string' ? o.label : 'Opción',
      description: typeof o.description === 'string' ? o.description : '',
      defaultOn: typeof o.defaultOn === 'boolean' ? o.defaultOn : true,
      blockContent: typeof o.blockContent === 'string' ? o.blockContent : '',
      documentMarker: dm,
    });
  }
  return out;
}

function rowToTemplate(row: Record<string, unknown>): DocumentTemplate {
  const cat = String(row.categoria ?? '');
  const tipo = String(row.tipo ?? '');
  const mapeoRaw = row.docx_mapeo;
  let docxMapeo: DocumentTemplate['docxMapeo'] = null;
  if (Array.isArray(mapeoRaw)) {
    const pairs: Array<{ original: string; marcador: string }> = [];
    for (const item of mapeoRaw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as { original?: unknown; marcador?: unknown };
      if (typeof o.original === 'string' && typeof o.marcador === 'string') {
        pairs.push({ original: o.original, marcador: o.marcador });
      }
    }
    docxMapeo = pairs.length ? pairs : null;
  }
  return {
    id: String(row.id),
    courtId: String(row.court_id ?? ''),
    categoria:
      cat === 'despacho' || cat === 'secretaria' ? (cat as DocumentTemplateCategoria) : 'secretaria',
    tipo:
      tipo === 'informe_ingreso' || tipo === 'auto_admisorio' || tipo === 'libre'
        ? (tipo as DocumentTemplateTipo)
        : 'libre',
    nombre: String(row.nombre ?? ''),
    descripcion: row.descripcion ? String(row.descripcion) : undefined,
    contenidoBase: row.contenido_base != null && String(row.contenido_base).trim() !== '' ? String(row.contenido_base) : null,
    toggleDefs: parseToggleDefs(row.template_toggles),
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order ?? 0),
    docxStoragePath:
      row.docx_storage_path != null && String(row.docx_storage_path).trim() !== ''
        ? String(row.docx_storage_path)
        : null,
    docxMapeo,
    pageLayout:
      row.page_layout != null && typeof row.page_layout === 'object'
        ? mergePageLayout(row.page_layout as DocumentTemplatePageLayout)
        : null,
  };
}

export async function fetchDocumentTemplates(courtId: string): Promise<DocumentTemplate[]> {
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('court_id', courtId)
    .order('sort_order', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) throw new Error(userFacingSupabaseError(error));
  return (data ?? []).map((r) => rowToTemplate(r as Record<string, unknown>));
}

export async function insertDocumentTemplate(input: {
  courtId: string;
  categoria: DocumentTemplateCategoria;
  tipo: DocumentTemplateTipo;
  nombre: string;
  descripcion?: string;
  contenidoBase?: string | null;
  toggleDefs?: DocumentTemplateToggleDef[];
  sortOrder?: number;
}): Promise<DocumentTemplate> {
  await ensureSupabaseSessionForWrites();
  const { data, error } = await supabase
    .from('document_templates')
    .insert({
      court_id: input.courtId,
      categoria: input.categoria,
      tipo: input.tipo,
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      contenido_base: input.contenidoBase?.trim() ? input.contenidoBase.trim() : null,
      template_toggles: input.toggleDefs?.length ? input.toggleDefs : [],
      sort_order: input.sortOrder ?? 0,
    })
    .select('*')
    .single();
  if (error) throw new Error(userFacingSupabaseError(error));
  return rowToTemplate(data as Record<string, unknown>);
}

export async function deleteDocumentTemplate(id: string): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const { error } = await supabase.from('document_templates').delete().eq('id', id);
  if (error) throw new Error(userFacingSupabaseError(error));
}

export async function updateDocumentTemplate(
  id: string,
  patch: Partial<
    Pick<
      DocumentTemplate,
      | 'nombre'
      | 'descripcion'
      | 'contenidoBase'
      | 'sortOrder'
      | 'docxStoragePath'
      | 'docxMapeo'
      | 'toggleDefs'
      | 'pageLayout'
    >
  >,
): Promise<{ id: string; contenidoBase: string | null }> {
  await ensureSupabaseSessionForWrites();
  const row: Record<string, unknown> = {};
  const normalizedPayload =
    patch.contenidoBase !== undefined
      ? patch.contenidoBase?.trim()
        ? patch.contenidoBase.trim()
        : null
      : undefined;
  if (patch.nombre != null) row.nombre = patch.nombre;
  if (patch.descripcion !== undefined) row.descripcion = patch.descripcion || null;
  if (patch.contenidoBase !== undefined) row.contenido_base = normalizedPayload;
  if (patch.sortOrder != null) row.sort_order = patch.sortOrder;
  if (patch.docxStoragePath !== undefined) {
    row.docx_storage_path = patch.docxStoragePath?.trim() ? patch.docxStoragePath.trim() : null;
  }
  if (patch.docxMapeo !== undefined) {
    row.docx_mapeo = patch.docxMapeo?.length ? patch.docxMapeo : null;
  }
  if (patch.toggleDefs !== undefined) {
    row.template_toggles = patch.toggleDefs;
  }
  if (patch.pageLayout !== undefined) {
    row.page_layout = patch.pageLayout;
  }
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('document_templates')
    .update(row)
    .eq('id', id)
    .select('id, contenido_base')
    .single();
  if (error) throw new Error(userFacingSupabaseError(error));
  if (!data || String((data as { id?: unknown }).id ?? '') !== id) {
    throw new Error('No se pudo confirmar la persistencia de la plantilla (sin fila devuelta).');
  }

  const persisted = (data as { contenido_base?: unknown }).contenido_base;
  const persistedNormalized = persisted != null && String(persisted).trim() !== '' ? String(persisted).trim() : null;
  if (normalizedPayload !== undefined && persistedNormalized !== normalizedPayload) {
    throw new Error('La plantilla no quedó persistida correctamente en BD (valor distinto al enviado).');
  }

  if (import.meta.env.DEV) {
    console.info('[document_templates:update]', {
      id,
      payloadContenidoBaseLength: normalizedPayload?.length ?? 0,
      persistedContenidoBaseLength: persistedNormalized?.length ?? 0,
      matches: normalizedPayload === undefined ? 'n/a' : persistedNormalized === normalizedPayload,
    });
  }

  return { id, contenidoBase: persistedNormalized };
}

/** Sube el PDF del informe al expediente (cuaderno principal, al final del orden) y marca el caso. */
export async function registerCaseInformeIngresoWithExpedientePdf(opts: {
  caseId: string;
  pdfBytes: Uint8Array;
  displayName: string;
  docs: Document[];
}): Promise<void> {
  await ensureSupabaseSessionForWrites();
  const sortOrder = nextSortOrderInPrincipalNotebook(opts.docs);
  const up = await uploadCaseAttachment(supabase, opts.caseId, opts.displayName, opts.pdfBytes, 'application/pdf');
  if ('error' in up) throw up.error;

  const row: Record<string, unknown> = {
    case_id: opts.caseId,
    name: opts.displayName,
    original_name: opts.displayName,
    type: 'informe_ingreso_expediente',
    content_type: 'application/pdf',
    size: opts.pdfBytes.byteLength,
    storage_path: up.path,
    is_from_link: false,
    sort_order: sortOrder,
    notebook_code: DEFAULT_NOTEBOOK_CODE,
  };

  const { id: documentId } = await insertCaseDocumentRowReturningId(supabase, row);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('cases')
    .update({
      informe_ingreso_registrado_at: now,
      informe_ingreso_document_id: documentId,
      updated_at: now,
    })
    .eq('id', opts.caseId);
  if (error) throw error;
}
