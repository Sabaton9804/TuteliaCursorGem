import type { Case, Document } from '../types';

export type PiezaActionGate = { allowed: boolean; reason?: string };

export function canRenameExpedientePieza(doc: Document): PiezaActionGate {
  if (doc.type === 'email_body') {
    return { allowed: false, reason: 'La constancia de ingreso no se renombra desde aquí.' };
  }
  return { allowed: true };
}

export function canDeleteExpedientePieza(doc: Document, caseItem: Case): PiezaActionGate {
  if (doc.type === 'email_body') {
    return {
      allowed: true,
      reason:
        'Es la constancia del correo de reparto. Al eliminarla podrá volver a cargarla en el expediente si la necesita.',
    };
  }
  if (caseItem.informeIngresoDocumentId === doc.id || doc.type === 'informe_ingreso_expediente') {
    return {
      allowed: true,
      reason:
        'Es el informe de ingreso registrado. Al eliminarlo, el proceso quedará sin PDF de informe y podrá cargarlo de nuevo desde Documentos del despacho.',
    };
  }
  if (doc.type === 'borrador_auto_admisorio_revision') {
    return {
      allowed: false,
      reason: 'Gestione el borrador en Documentos del despacho / revisión Word.',
    };
  }
  if (doc.sgdeId?.trim()) {
    return {
      allowed: true,
      reason:
        'Se eliminará solo en Tutelia. El archivo en SGDE no se borra automáticamente; retírelo en el portal si corresponde.',
    };
  }
  return { allowed: true };
}

export function canSignExpedientePiezaInSgde(doc: Document): PiezaActionGate {
  if (!doc.sgdeId?.trim()) {
    return {
      allowed: false,
      reason: 'Sincronice la pieza con SGDE (barra inferior) para habilitar la firma en Rama.',
    };
  }
  const nm = (doc.name || '').toLowerCase();
  const ct = (doc.contentType || '').toLowerCase();
  if (!nm.endsWith('.pdf') && !ct.includes('pdf')) {
    return {
      allowed: false,
      reason: 'Solo se firman PDF en SGDE. Los autos deben subirse como PDF firmado, no Word.',
    };
  }
  return { allowed: true };
}
