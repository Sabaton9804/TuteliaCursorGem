import type { Case, Document } from '../types';

export type CaseSgdeLinkStatus = 'unlinked' | 'linked' | 'stale';

export type DocumentSgdeSyncStatus = 'none' | 'linked' | 'local_only' | 'sgde_only';

export const DOCUMENT_SGDE_SYNC_LABELS: Record<DocumentSgdeSyncStatus, string> = {
  none: 'Sin SGDE',
  linked: 'Sincronizado',
  local_only: 'Solo Jurion',
  sgde_only: 'Solo SGDE',
};

export const DOCUMENT_SGDE_SYNC_STYLES: Record<DocumentSgdeSyncStatus, string> = {
  none: 'bg-slate-50 text-slate-600 border border-slate-200',
  linked: 'bg-emerald-50 text-emerald-800 border border-emerald-100',
  local_only: 'bg-violet-50 text-violet-800 border border-violet-100',
  sgde_only: 'bg-amber-50 text-amber-900 border border-amber-100',
};

/** Estado de enlace del expediente con el nodo raíz SGDE. */
export function caseSgdeLinkStatus(caseItem: Case): CaseSgdeLinkStatus {
  const id = caseItem.sgdeId?.trim();
  if (!id) return 'unlinked';
  if (caseItem.sgdeSyncStatus === 'stale' || caseItem.sgdeSyncStatus === 'error') return 'stale';
  return 'linked';
}

export function caseSgdeLinkLabel(status: CaseSgdeLinkStatus): string {
  switch (status) {
    case 'linked':
      return 'Vinculado a SGDE';
    case 'stale':
      return 'Revisar enlace SGDE';
    default:
      return 'Sin vínculo SGDE';
  }
}

export function documentSgdeSyncStatus(doc: Document): DocumentSgdeSyncStatus {
  if (doc.sgdeSyncStatus && doc.sgdeSyncStatus !== 'none') {
    return doc.sgdeSyncStatus;
  }
  const hasSgde = Boolean(doc.sgdeId?.trim());
  const hasLocal = Boolean(doc.storagePath?.trim() || doc.content);
  if (doc.type === 'sgde_migrate' && hasSgde) return 'linked';
  if (hasLocal && hasSgde) return 'linked';
  if (hasLocal && !hasSgde) return 'local_only';
  if (!hasLocal && hasSgde) return 'sgde_only';
  return 'none';
}

export function countDocumentSyncSummary(docs: Document[]): {
  total: number;
  linked: number;
  localOnly: number;
  sgdeOnly: number;
} {
  let linked = 0;
  let localOnly = 0;
  let sgdeOnly = 0;
  for (const d of docs) {
    const s = documentSgdeSyncStatus(d);
    if (s === 'linked') linked += 1;
    else if (s === 'local_only') localOnly += 1;
    else if (s === 'sgde_only') sgdeOnly += 1;
  }
  return { total: docs.length, linked, localOnly, sgdeOnly };
}
