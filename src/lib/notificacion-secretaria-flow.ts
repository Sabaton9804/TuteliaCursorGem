import type { CaseType, Document, DocumentTemplatePageLayout } from '../types';
import { buildInformeIngresoPlainTextPdfBlob } from './generate-judicial-pdf';
import { registerCaseActoPdfEnExpediente } from './document-templates';
import { suggestedLogicalNameForAct } from './case-act-types';
import {
  applyStageTransitionNotificacionAutoEnviada,
  applyStageTransitionNotificacionFalloEnviada,
} from './case-stages-service';
import { sendOutlookMail } from './outlook-api';
import { supabase } from './supabase';

export type NotificacionSecretariaKind = 'notificacion_admisorio' | 'notificacion_fallo';

export function parseEmailRecipients(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

export function plainTextToSimpleHtml(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:Georgia,serif;font-size:12pt;white-space:pre-wrap">${esc}</div>`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function ejecutarFlujoNotificacionSecretaria(opts: {
  kind: NotificacionSecretariaKind;
  caseId: string;
  courtId: string;
  radicado: string;
  caseType: CaseType;
  caseAssignedTo?: string | null;
  docs: Document[];
  plainText: string;
  pageLayout: DocumentTemplatePageLayout | null | undefined;
  recipientsRaw: string;
  notifiedAt: string;
  advanceStage: boolean;
}): Promise<void> {
  const to = parseEmailRecipients(opts.recipientsRaw);
  if (!to.length) throw new Error('Indique al menos un correo electrónico de destinatario.');

  const pdfBlob = await buildInformeIngresoPlainTextPdfBlob({
    fullPlainText: opts.plainText,
    pageLayout: opts.pageLayout ?? null,
  });
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const actCode = opts.kind;
  const displayName = suggestedLogicalNameForAct(actCode);
  const actSequence = opts.kind === 'notificacion_admisorio' ? 7 : 21;

  await registerCaseActoPdfEnExpediente({
    caseId: opts.caseId,
    caseType: opts.caseType,
    pdfBytes,
    displayName,
    docs: opts.docs,
    actCode,
    actSequence,
    sourceChannel: 'generado',
  });

  const subject =
    opts.kind === 'notificacion_admisorio'
      ? `Notificación auto admisorio — Rad. ${opts.radicado}`
      : `Notificación del fallo — Rad. ${opts.radicado}`;

  await sendOutlookMail({
    subject,
    bodyHtml: plainTextToSimpleHtml(opts.plainText),
    to,
    attachments: [
      {
        name: `${displayName}.pdf`,
        contentType: 'application/pdf',
        contentBytesBase64: uint8ToBase64(pdfBytes),
      },
    ],
  });

  if (!opts.advanceStage) return;

  const stageOpts = {
    caseId: opts.caseId,
    courtId: opts.courtId,
    radicado: opts.radicado,
    caseType: opts.caseType,
    caseAssignedTo: opts.caseAssignedTo,
    notifiedAt: opts.notifiedAt,
  };

  if (opts.kind === 'notificacion_admisorio') {
    await applyStageTransitionNotificacionAutoEnviada(supabase, stageOpts);
  } else {
    await applyStageTransitionNotificacionFalloEnviada(supabase, stageOpts);
  }
}
