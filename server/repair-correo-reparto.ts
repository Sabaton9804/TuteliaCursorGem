import type { SupabaseClient } from '@supabase/supabase-js';
import { emailBodyToPdfBytes } from '../src/lib/new-case-email-attachment.ts';
import { uploadCaseAttachmentAdmin } from './case-document-storage.js';

export type RepairCorreoRepartoResult = {
  ok: boolean;
  repaired: number;
  message: string;
  errors: string[];
};

function isCorreoRepartoRow(row: Record<string, unknown>): boolean {
  const type = String(row.type || '');
  const name = String(row.name || '');
  const act = String(row.act_code || '');
  return (
    type === 'email_body' ||
    act === 'correo_reparto' ||
    /^CorreoReparto/i.test(name) ||
    (name.toLowerCase().includes('correo') && name.toLowerCase().includes('reparto'))
  );
}

export async function repairCorreoRepartoPdf(opts: {
  admin: SupabaseClient;
  caseId: string;
  documentId?: string;
}): Promise<RepairCorreoRepartoResult> {
  const { admin, caseId, documentId } = opts;
  const errors: string[] = [];
  let repaired = 0;

  const { data: caseRow, error: caseErr } = await admin
    .from('cases')
    .select('id, subject, raw_text')
    .eq('id', caseId)
    .maybeSingle();
  if (caseErr || !caseRow?.id) {
    return { ok: false, repaired: 0, message: 'Expediente no encontrado.', errors: ['case_not_found'] };
  }

  const subject = String(caseRow.subject || 'Correo de reparto').trim() || 'Correo de reparto';
  const body = String(caseRow.raw_text || '');

  let docQuery = admin.from('case_documents').select('*').eq('case_id', caseId);
  if (documentId) {
    docQuery = docQuery.eq('id', documentId);
  }
  const { data: rows, error: docErr } = await docQuery;
  if (docErr) {
    return { ok: false, repaired: 0, message: docErr.message, errors: [docErr.message] };
  }

  const targets = (rows || []).filter((row) => {
    const r = row as Record<string, unknown>;
    if (!isCorreoRepartoRow(r)) return false;
    if (documentId) return true;
    return Boolean(r.error) || !String(r.storage_path || '').trim();
  });

  if (targets.length === 0) {
    return {
      ok: true,
      repaired: 0,
      message: 'No hay correo de reparto pendiente de reparar.',
      errors: [],
    };
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await emailBodyToPdfBytes(subject, body);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return { ok: false, repaired: 0, message: msg, errors: [msg] };
  }

  for (const row of targets) {
    const r = row as Record<string, unknown>;
    const id = String(r.id || '');
    const logicalName = String(r.name || 'CorreoReparto');
    try {
      const up = await uploadCaseAttachmentAdmin(
        admin,
        caseId,
        logicalName.endsWith('.pdf') ? logicalName : `${logicalName}.pdf`,
        Buffer.from(pdfBytes),
        'application/pdf'
      );
      if ('error' in up) throw up.error;

      const { error: updErr } = await admin
        .from('case_documents')
        .update({
          storage_path: up.path,
          content_type: 'application/pdf',
          size: pdfBytes.byteLength,
          error: null,
          content: null,
        })
        .eq('id', id)
        .eq('case_id', caseId);
      if (updErr) throw updErr;
      repaired += 1;
    } catch (e) {
      errors.push(`${logicalName}: ${String((e as Error)?.message || e)}`);
    }
  }

  return {
    ok: errors.length === 0 && repaired > 0,
    repaired,
    message:
      repaired > 0
        ? `Correo de reparto regenerado (${repaired} pieza${repaired === 1 ? '' : 's'}).`
        : errors[0] || 'No se pudo reparar el correo de reparto.',
    errors,
  };
}
