import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient } from './sgde-client';
import { CASE_DOCUMENTS_BUCKET, sanitizeCaseDocumentLogicalName } from './case-document-storage';
import { plainTextToPdfBuffer } from './sgde-email-pdf';
import {
  buildSgdeExpedienteProperties,
  tipoDocumentalSgdeSegundaFromFileName,
  uploadOrderPrioritySegunda,
} from './sgde-tutela-metadata';

const SGDE_IMPUGNACION_PATH = 'Segunda instancia / Impugnación';
const NOTEBOOK_SI = 'SI_C01_PRINCIPAL';

export type PublishSegundaImpugnacionResult = {
  ok: boolean;
  sgdeRootId: string;
  impugnacionFolderId: string;
  uploaded: number;
  uploadFailed: number;
  uploadErrors: string[];
  message: string;
};

type CaseRow = {
  id: string;
  court_id: string;
  radicado: string;
  claimant: string;
  defendant: string;
  subject: string | null;
  raw_text: string | null;
  sgde_id: string | null;
};

type DocRow = {
  id: string;
  name: string;
  type: string;
  storage_path: string | null;
  content_type: string | null;
  notebook_code: string | null;
};

/**
 * No crea expediente en SGDE: usa el nodo ya localizado (preflight) y solo
 * asegura Segunda instancia → Impugnación, luego sube piezas del traslado.
 */
export async function publishSegundaTrasladoToSgdeImpugnacion(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  sgdeRootId: string;
  originRadicado23: string;
}): Promise<PublishSegundaImpugnacionResult> {
  const { client, admin, caseId } = opts;
  const originRadicado23 = opts.originRadicado23.replace(/\D/g, '').slice(0, 23);
  let sgdeRootId = String(opts.sgdeRootId || '').trim().toLowerCase();

  if (!sgdeRootId) {
    sgdeRootId = (await client.buscarExpedienteNodeId(originRadicado23)) || '';
  }
  if (!sgdeRootId) {
    throw new Error(
      'No hay nodo SGDE del expediente. Ejecute Actualizar en traslado digital antes de radicar.'
    );
  }

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('id, court_id, radicado, claimant, defendant, subject, raw_text, sgde_id')
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow?.id) throw new Error('Expediente Tutelia no encontrado.');

  const c = caseRow as CaseRow;
  const props = buildSgdeExpedienteProperties({
    radicado23: originRadicado23,
    claimant: c.claimant,
    defendant: c.defendant,
  });

  const folders = await client.ensureSegundaInstanciaImpugnacion(sgdeRootId);
  if (folders.ok === false) throw new Error(folders.error);

  const now = new Date().toISOString();
  await admin
    .from('cases')
    .update({
      sgde_id: sgdeRootId,
      sgde_linked_at: now,
      sgde_sync_status: 'linked',
      updated_at: now,
    })
    .eq('id', caseId);

  await admin.from('case_sgde_folder_map').upsert(
    {
      court_id: c.court_id,
      case_id: caseId,
      notebook_code: NOTEBOOK_SI,
      sgde_folder_node_id: folders.impugnacionFolderId,
      folder_path: SGDE_IMPUGNACION_PATH,
    },
    { onConflict: 'case_id,notebook_code' }
  );

  const { data: docs } = await admin
    .from('case_documents')
    .select('id, name, type, storage_path, content_type, notebook_code')
    .eq('case_id', caseId)
    .neq('type', 'sgde_migrate')
    .order('sort_order', { ascending: true });

  const candidates = ((docs || []) as DocRow[]).sort(
    (a, b) => uploadOrderPrioritySegunda(a.name, a.type) - uploadOrderPrioritySegunda(b.name, b.type)
  );

  let uploaded = 0;
  let uploadFailed = 0;
  const uploadErrors: string[] = [];
  let orden = 1;

  for (const doc of candidates) {
    try {
      let buf: Buffer | null = null;
      let fileName = sanitizeCaseDocumentLogicalName(`${doc.name}.pdf`, `${doc.name}.pdf`);

      if (doc.type === 'email_body') {
        const subject = String(c.subject || 'Correo de reparto');
        const text = String(c.raw_text || '').trim() || '(Sin cuerpo de texto)';
        buf = await plainTextToPdfBuffer(subject, text);
        fileName = sanitizeCaseDocumentLogicalName(`${doc.name}.pdf`, `${doc.name}.pdf`);
      } else if (doc.storage_path?.trim()) {
        const { data: blob, error: dlErr } = await admin.storage
          .from(CASE_DOCUMENTS_BUCKET)
          .download(String(doc.storage_path));
        if (dlErr || !blob) {
          uploadFailed += 1;
          uploadErrors.push(`${doc.name}: no se leyó desde Storage`);
          continue;
        }
        buf = Buffer.from(await blob.arrayBuffer());
      }

      if (!buf?.length || buf.length < 100) {
        uploadFailed += 1;
        uploadErrors.push(`${doc.name}: sin contenido PDF`);
        continue;
      }

      const tipo = tipoDocumentalSgdeSegundaFromFileName(doc.name, doc.type);
      const up = await client.uploadDocumentToFolder({
        folderNodeUuid: folders.impugnacionFolderId,
        radicado23: originRadicado23,
        buffer: buf,
        fileName,
        contentType: 'application/pdf',
        tipoDocumental: tipo,
        expedienteMetadata: props,
        orden,
      });
      orden += 1;

      if (up.ok === false) {
        uploadFailed += 1;
        uploadErrors.push(`${doc.name}: ${up.error}`);
        continue;
      }

      uploaded += 1;
      const patch: Record<string, unknown> = {
        sgde_folder_path: SGDE_IMPUGNACION_PATH,
        sgde_sync_status: 'linked',
      };
      if (up.sgdeDocId) patch.sgde_id = up.sgdeDocId;
      await admin.from('case_documents').update(patch).eq('id', doc.id);
    } catch (e) {
      uploadFailed += 1;
      uploadErrors.push(`${doc.name}: ${(e as Error)?.message || e}`);
    }
  }

  const msg =
    uploaded > 0
      ? `Enlazado a SGDE existente; ${uploaded} documento(s) en ${SGDE_IMPUGNACION_PATH}.`
      : `Carpeta ${SGDE_IMPUGNACION_PATH} lista en SGDE; no se subieron documentos nuevos.`;

  return {
    ok: uploadFailed === 0,
    sgdeRootId,
    impugnacionFolderId: folders.impugnacionFolderId,
    uploaded,
    uploadFailed,
    uploadErrors,
    message: msg,
  };
}
