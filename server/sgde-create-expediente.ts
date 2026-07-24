import type { SupabaseClient } from '@supabase/supabase-js';
import type { SgdeClient } from './sgde-client';
import {
  buildSgdeExpedienteProperties,
  courtRadicacionCode12FromRow,
  tipoDocumentalSgdeFromFileName,
  uploadOrderPriority,
} from './sgde-tutela-metadata';
import { CASE_DOCUMENTS_BUCKET, sanitizeCaseDocumentLogicalName } from './case-document-storage';
import { isSgdeAutoCreateCaseType } from '../src/lib/sgde-case-scope.ts';
import {
  caseHasCautelarNotebook,
  NOTEBOOK_PI_C01_PRINCIPAL,
  NOTEBOOK_PI_C02_CAUTELAR,
  normalizeNotebookCode,
} from '../src/lib/expediente-notebook.ts';
import type { ExpedienteCuadernoExtra } from '../src/lib/expediente-extra-cuadernos.ts';
import type { CaseType } from '../src/types.ts';

function parseCuadernosExtra(raw: unknown): ExpedienteCuadernoExtra[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => ({
      code: String((e as { code?: string }).code || '').trim(),
      label: String((e as { label?: string }).label || '').trim(),
    }))
    .filter((e) => e.code);
}

export type CreateExpedienteInSgdeResult = {
  ok: boolean;
  sgdeRootId: string;
  yaExiste?: boolean;
  uploaded: number;
  uploadFailed: number;
  uploadErrors: string[];
  principalFolderId?: string;
  message: string;
};

type CaseRow = {
  id: string;
  court_id: string;
  radicado: string;
  claimant: string;
  defendant: string;
  case_type: string | null;
  sgde_id: string | null;
  expediente_cuadernos_extra?: unknown;
};

type CourtSgdeRow = {
  id: string;
  name: string;
  dane_code: string | null;
  entity_code: string | null;
  specialty_code: string | null;
  despacho_number: string | null;
  sgde_parent_node_id: string | null;
  sgde_upload_docs_on_create: boolean | null;
};

type DocRow = {
  id: string;
  name: string;
  type: string;
  storage_path: string | null;
  content_type: string | null;
  act_code?: string | null;
  notebook_code: string | null;
};

export async function createExpedienteInSgde(opts: {
  client: SgdeClient;
  admin: SupabaseClient;
  caseId: string;
  uploadDocuments?: boolean;
  forceUpload?: boolean;
}): Promise<CreateExpedienteInSgdeResult> {
  const { client, admin, caseId } = opts;
  const uploadDocuments = opts.uploadDocuments !== false;

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('id, court_id, radicado, claimant, defendant, case_type, sgde_id, expediente_cuadernos_extra')
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow?.id) {
    throw new Error('Expediente Jurion no encontrado.');
  }
  const c = caseRow as CaseRow;
  const caseType = String(c.case_type || 'tutela_primera');
  if (!isSgdeAutoCreateCaseType(caseType as CaseType)) {
    throw new Error('La creación automática en SGDE no aplica a este tipo de expediente.');
  }

  const radicado23 = String(c.radicado || '').replace(/\D/g, '').slice(0, 23);
  if (radicado23.length !== 23) {
    throw new Error('El expediente no tiene un radicado válido de 23 dígitos.');
  }

  const { data: courtRow, error: courtErr } = await admin
    .from('courts')
    .select('id, name, dane_code, entity_code, specialty_code, despacho_number, sgde_parent_node_id, sgde_upload_docs_on_create')
    .eq('id', c.court_id)
    .maybeSingle();
  if (courtErr || !courtRow?.id) {
    throw new Error('No se encontró el juzgado del expediente.');
  }
  const court = courtRow as CourtSgdeRow;

  const props = buildSgdeExpedienteProperties({
    radicado23,
    claimant: c.claimant,
    defendant: c.defendant,
    courtName: court.name,
  });

  let sgdeRootId = String(c.sgde_id || '').trim();
  let yaExiste = false;

  if (sgdeRootId) {
    yaExiste = true;
  } else {
    const existing = await client.buscarExpedienteNodeId(radicado23);
    if (existing) {
      sgdeRootId = existing;
      yaExiste = true;
    }
  }

  if (!sgdeRootId) {
    let parentId =
      String(court.sgde_parent_node_id || '').trim() ||
      String(process.env.SGDE_PARENT_EXPEDIENTES_NODE_ID || '').trim();

    if (!parentId) {
      parentId = (await client.resolveParentContainer(courtRadicacionCode12FromRow(court))) || '';
    }

    if (!parentId) {
      throw new Error(
        'No se localizó el contenedor de expedientes del despacho en SGDE. Configure sgde_parent_node_id en el juzgado o SGDE_PARENT_EXPEDIENTES_NODE_ID.'
      );
    }

    if (!court.sgde_parent_node_id?.trim() && parentId) {
      await admin
        .from('courts')
        .update({ sgde_parent_node_id: parentId, updated_at: new Date().toISOString() })
        .eq('id', court.id);
    }

    const created = await client.createExpedienteNode(parentId, radicado23, props);
    if (created.ok === false) throw new Error(created.error);
    sgdeRootId = created.nodeId;
    yaExiste = created.yaExiste === true;
  }

  const structure = await client.ensurePrimeraInstanciaPrincipal(sgdeRootId);
  if (structure.ok === false) {
    throw new Error(structure.error);
  }

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

  const notebookCode = 'PI_C01_PRINCIPAL';
  await admin.from('case_sgde_folder_map').upsert(
    {
      court_id: c.court_id,
      case_id: caseId,
      notebook_code: notebookCode,
      sgde_folder_node_id: structure.principalFolderId,
      folder_path: 'Primera instancia / Principal',
    },
    { onConflict: 'case_id,notebook_code' }
  );

  const extras = parseCuadernosExtra(c.expediente_cuadernos_extra);
  let cautelarFolderId = '';
  if (caseHasCautelarNotebook(extras)) {
    const cautelar = await client.ensurePrimeraInstanciaCautelar(sgdeRootId);
    if (cautelar.ok === false) {
      throw new Error(cautelar.error);
    }
    cautelarFolderId = cautelar.cautelarFolderId;
    await admin.from('case_sgde_folder_map').upsert(
      {
        court_id: c.court_id,
        case_id: caseId,
        notebook_code: NOTEBOOK_PI_C02_CAUTELAR,
        sgde_folder_node_id: cautelar.cautelarFolderId,
        folder_path: 'Primera instancia / Medidas cautelares',
      },
      { onConflict: 'case_id,notebook_code' }
    );
  }

  let uploaded = 0;
  let uploadFailed = 0;
  const uploadErrors: string[] = [];

  const shouldUpload =
    uploadDocuments && (court.sgde_upload_docs_on_create !== false);

  if (shouldUpload) {
    const { data: docs } = await admin
      .from('case_documents')
      .select('id, name, type, storage_path, content_type, notebook_code, act_code')
      .eq('case_id', caseId)
      .order('sort_order', { ascending: true });

    const candidates = ((docs || []) as DocRow[])
      .filter((d) => {
        if (!d.storage_path?.trim()) return false;
        if (d.type === 'sgde_migrate') return false;
        const ct = String(d.content_type || '').toLowerCase();
        const nm = String(d.name || '').toLowerCase();
        return ct.includes('pdf') || nm.endsWith('.pdf');
      })
      .sort(
        (a, b) =>
          uploadOrderPriority(a.name, a.type, a.act_code) -
          uploadOrderPriority(b.name, b.type, b.act_code),
      );

    const ordenByFolder = new Map<string, number>();
    for (const doc of candidates) {
      const path = String(doc.storage_path || '').trim();
      const { data: blob, error: dlErr } = await admin.storage.from(CASE_DOCUMENTS_BUCKET).download(path);
      if (dlErr || !blob) {
        uploadFailed += 1;
        uploadErrors.push(`${doc.name}: no se pudo leer desde Storage`);
        continue;
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      if (buf.length < 100) {
        uploadFailed += 1;
        uploadErrors.push(`${doc.name}: archivo vacío`);
        continue;
      }

      const logicalName = sanitizeCaseDocumentLogicalName(String(doc.name || ''), 'documento.pdf');
      const tipo = tipoDocumentalSgdeFromFileName(doc.name, doc.type, doc.act_code);
      const docNb = normalizeNotebookCode(doc.notebook_code || notebookCode);
      const useCautelar = docNb === NOTEBOOK_PI_C02_CAUTELAR && Boolean(cautelarFolderId);
      const folderNodeUuid = useCautelar ? cautelarFolderId : structure.principalFolderId;
      const folderPath = useCautelar
        ? 'Primera instancia / Medidas cautelares'
        : 'Primera instancia / Principal';
      const orden = (ordenByFolder.get(folderNodeUuid) || 0) + 1;
      ordenByFolder.set(folderNodeUuid, orden);

      const up = await client.uploadDocumentToFolder({
        folderNodeUuid,
        radicado23,
        buffer: buf,
        fileName: logicalName,
        contentType: 'application/pdf',
        tipoDocumental: tipo,
        expedienteMetadata: props,
        orden,
      });

      if (up.ok === false) {
        uploadFailed += 1;
        uploadErrors.push(`${doc.name}: ${up.error}`);
        continue;
      }

      uploaded += 1;
      const patch: Record<string, unknown> = {
        sgde_folder_path: folderPath,
        sgde_sync_status: 'linked',
        notebook_code:
          docNb === NOTEBOOK_PI_C02_CAUTELAR || docNb === NOTEBOOK_PI_C01_PRINCIPAL
            ? docNb
            : normalizeNotebookCode(doc.notebook_code || notebookCode),
      };
      if (up.sgdeDocId) patch.sgde_id = up.sgdeDocId;
      await admin.from('case_documents').update(patch).eq('id', doc.id);
    }
  }

  const msg = yaExiste
    ? `Expediente enlazado en SGDE (${sgdeRootId.slice(0, 8)}…).`
    : `Expediente creado en SGDE (${sgdeRootId.slice(0, 8)}…).`;
  const uploadMsg =
    shouldUpload && (uploaded > 0 || uploadFailed > 0)
      ? ` Subidos ${uploaded} PDF${uploadFailed ? `; ${uploadFailed} fallo(s).` : '.'}`
      : '';

  return {
    ok: uploadFailed === 0,
    sgdeRootId,
    yaExiste,
    uploaded,
    uploadFailed,
    uploadErrors,
    principalFolderId: structure.principalFolderId,
    message: msg + uploadMsg,
  };
}
