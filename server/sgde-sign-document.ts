import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient } from './sgde-client';
import {
  CASE_DOCUMENTS_BUCKET,
  removeCaseDocumentObjectsAdmin,
  sanitizeCaseDocumentLogicalName,
  uploadCaseAttachmentAdmin,
} from './case-document-storage';
import { getUserSgdeCredentials } from './sgde-credentials';

export type SignDocumentInSgdeResult = {
  ok: boolean;
  message: string;
  refreshed?: boolean;
};

function isPdfDocument(name: string, contentType: string | null): boolean {
  const nm = name.toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  return nm.endsWith('.pdf') || ct.includes('pdf');
}

export async function signCaseDocumentInSgde(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  userId: string;
  caseId: string;
  documentId: string;
  /** Si se omite, se usa la contraseña guardada en Ajustes → SGDE. */
  password?: string;
  /** Si se omite, se usa el usuario guardado en Ajustes → SGDE. */
  username?: string;
  refreshLocal?: boolean;
}): Promise<SignDocumentInSgdeResult> {
  const { client, admin, userId, caseId, documentId } = opts;
  const refreshLocal = opts.refreshLocal !== false;

  const creds = await getUserSgdeCredentials(admin, userId);
  if (!creds?.username) {
    return {
      ok: false,
      message: 'Configure su usuario SGDE en Ajustes → Interconexión SGDE.',
    };
  }

  const username = String(opts.username || creds.username).trim();
  const password = String(opts.password ?? creds.password);
  if (!username || !password) {
    return {
      ok: false,
      message: 'Indique usuario y contraseña SGDE para firmar (o guárdelos en Ajustes).',
    };
  }

  const { data: docRow, error: docErr } = await admin
    .from('case_documents')
    .select('id, name, type, content_type, storage_path, sgde_id, sgde_folder_path, notebook_code')
    .eq('id', documentId)
    .eq('case_id', caseId)
    .maybeSingle();

  if (docErr || !docRow?.id) {
    return { ok: false, message: 'Documento no encontrado en el expediente.' };
  }

  const sgdeNodeId = String(docRow.sgde_id || '').trim().toLowerCase();
  if (!sgdeNodeId) {
    return {
      ok: false,
      message:
        'Este documento no está vinculado a un nodo SGDE. Sincronice el expediente con SGDE antes de firmar.',
    };
  }

  if (!isPdfDocument(String(docRow.name || ''), docRow.content_type ? String(docRow.content_type) : null)) {
    return { ok: false, message: 'Solo se pueden firmar documentos PDF en SGDE.' };
  }

  const signRes = await client.signDocument({
    nodeId: sgdeNodeId,
    username,
    password,
  });
  if (signRes.ok === false) {
    return { ok: false, message: signRes.message };
  }

  let refreshed = false;
  if (refreshLocal) {
    const dl = await client.downloadNodeContent(sgdeNodeId);
    if (dl?.buffer?.length) {
      const logicalName = sanitizeCaseDocumentLogicalName(
        String(docRow.name || 'documento.pdf'),
        'documento.pdf'
      );
      const up = await uploadCaseAttachmentAdmin(
        admin,
        caseId,
        logicalName,
        dl.buffer,
        dl.contentType || 'application/pdf'
      );
      if ('path' in up) {
        const oldPath = String(docRow.storage_path || '').trim();
        const patch: Record<string, unknown> = {
          storage_path: up.path,
          content_type: dl.contentType || 'application/pdf',
          size: dl.buffer.length,
          sgde_sync_status: 'linked',
          updated_at: new Date().toISOString(),
        };
        const { error: updErr } = await admin.from('case_documents').update(patch).eq('id', documentId);
        if (!updErr) {
          refreshed = true;
          if (oldPath && oldPath !== up.path) {
            await removeCaseDocumentObjectsAdmin(admin, [oldPath]);
          }
        }
      }
    }
  } else {
    await admin
      .from('case_documents')
      .update({ sgde_sync_status: 'linked', updated_at: new Date().toISOString() })
      .eq('id', documentId);
  }

  const suffix = refreshed
    ? ' Se actualizó la copia en Jurion desde SGDE.'
    : refreshLocal
      ? ' La firma en SGDE fue exitosa; no se pudo descargar la nueva versión a Jurion (use «Actualizar» en SGDE).'
      : '';

  return {
    ok: true,
    message: `Documento firmado en SGDE.${suffix}`,
    refreshed,
  };
}
