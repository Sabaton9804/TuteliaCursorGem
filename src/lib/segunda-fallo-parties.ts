import { inferActCodeFromDocument } from './case-act-types';
import type { Document } from '../types';

export type FalloPartyDocument = Pick<
  Document,
  'id' | 'name' | 'originalName' | 'actCode' | 'type' | 'notebookCode' | 'sgdeFolderPath' | 'sortOrder'
>;

function docLabel(doc: FalloPartyDocument): string {
  return `${doc.name || ''} ${doc.originalName || ''}`.toLowerCase();
}

function isFalloPrimeraCandidate(doc: FalloPartyDocument): boolean {
  const act = inferActCodeFromDocument(doc as Document);
  if (act === 'fallo_tutela' || act === 'sentencia') return true;
  const label = docLabel(doc).replace(/\s+/g, '');
  if (
    /notificacionfallo|notificadofallo|constancianotificofallo|notificadoautoconcede|autoconcedeimpugnacion/.test(
      label,
    )
  ) {
    return false;
  }
  if (/notif|constancia|informe|correo|acta|reparto|impugnacion/.test(label)) {
    if (!/(?:^|\d)fallo|falloniega|fallotutel|falloaccion|sentencia/.test(label)) return false;
  }
  return /(?:^|\d)fallo|falloniega|fallotutel|falloaccion|sentencia/.test(label);
}

function falloPrimeraScore(doc: FalloPartyDocument): number {
  let score = 0;
  const act = inferActCodeFromDocument(doc as Document);
  if (act === 'fallo_tutela') score += 100;
  if (act === 'sentencia') score += 90;
  const label = docLabel(doc);
  const compact = label.replace(/\s+/g, '');
  if (/^fallo/i.test(doc.name || '')) score += 40;
  if (/fallotutel/.test(compact)) score += 30;
  if (/falloniega|falloconcede|falloaccion/.test(compact) && !/notificacion/.test(compact)) score += 35;
  const nb = (doc.notebookCode || '').toUpperCase();
  const path = (doc.sgdeFolderPath || '').toLowerCase();
  if (nb.startsWith('PI_') || nb === 'SI_C01' || /primera|principal/.test(path)) score += 20;
  if (/expediente\s+juzgado|\d+\.\s*respuesta/.test(path)) score -= 45;
  if (typeof doc.sortOrder === 'number') score += doc.sortOrder / 1000;
  return score;
}

/** Elige el PDF del fallo de primera instancia migrado al expediente de 2ª. */
export function pickFalloPrimeraDocument(docs: FalloPartyDocument[]): FalloPartyDocument | null {
  const candidates = docs.filter(isFalloPrimeraCandidate);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => falloPrimeraScore(b) - falloPrimeraScore(a))[0] ?? null;
}

export type FalloPickerOption = FalloPartyDocument & {
  label: string;
  suggested: boolean;
  score: number;
};

function isPiExpedienteDocument(doc: FalloPartyDocument): boolean {
  const nb = (doc.notebookCode || '').toUpperCase();
  if (nb.startsWith('PI_') || nb === 'SI_C01_PRINCIPAL') return true;
  const path = (doc.sgdeFolderPath || '').toLowerCase();
  return /primera\s*instancia|01\s*cdo\s*principal|principal/.test(path) && !/impugnaci/.test(path);
}

function isExcludedFromFalloPicker(doc: FalloPartyDocument): boolean {
  const nb = (doc.notebookCode || '').toUpperCase();
  if (nb === 'SI_IMPUGNACION') return true;
  if (doc.type === 'email_body') return true;
  const compact = docLabel(doc).replace(/\s+/g, '');
  if (/correoreparto|actareparto|actadereparto/.test(compact)) return true;
  if (/^correo|^acta/.test(compact) && !/fallo|sentencia/.test(compact)) return true;
  return false;
}

/** PDFs del expediente PI (o todo el digital) para elegir manualmente el fallo fuente. */
export function listFalloPrimeraPickerOptions(
  docs: Array<FalloPartyDocument & { storagePath?: string | null }>,
): FalloPickerOption[] {
  const withStorage = docs.filter(
    (d) => typeof d.storagePath === 'string' && d.storagePath.trim().length > 0 && d.type !== 'email_body',
  );
  const piPool = withStorage.filter((d) => isPiExpedienteDocument(d) && !isExcludedFromFalloPicker(d));
  const pool = piPool.length > 0 ? piPool : withStorage.filter((d) => !isExcludedFromFalloPicker(d));

  return pool
    .map((d) => {
      const suggested = isFalloPrimeraCandidate(d);
      const score = suggested ? falloPrimeraScore(d) : isPiExpedienteDocument(d) ? 15 : 5;
      const label = (d.originalName || d.name || 'Documento').trim();
      return { ...d, label, suggested, score };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'es'));
}

export function defaultFalloPickerDocumentId(options: FalloPickerOption[]): string | null {
  const auto = pickFalloPrimeraDocument(options);
  if (auto?.id) return auto.id;
  const suggested = options.find((o) => o.suggested);
  return suggested?.id ?? options[0]?.id ?? null;
}

/** Detecta partes tomadas del correo de remisión en lugar del fallo PI. */
export function looksLikeSegundaMisassignedParties(
  claimant: string | null | undefined,
  defendant: string | null | undefined,
  claimantEmail?: string | null,
): boolean {
  const c = (claimant || '').trim();
  const d = (defendant || '').trim();
  const email = (claimantEmail || '').trim().toLowerCase();
  if (!c && !d) return false;

  const genericDefendant = !d || /^despacho\s+judicial$/i.test(d);
  const juzgadoClaimant =
    /juzgado\s+\d+/i.test(c) ||
    /pequeñas?\s+causas/i.test(c) ||
    /competencia\s+m[uú]ltiple/i.test(c) ||
    /cendoj\.ramajudicial/i.test(email) ||
    /@.*ramajudicial\.gov\.co/i.test(email);

  return juzgadoClaimant || (genericDefendant && juzgadoClaimant);
}

/** Tutela 2ª sin partes/hechos útiles: conviene leer el fallo PI migrado. */
export function needsSegundaPartiesRefreshFromFallo(
  caseItem: { claimant?: string | null; defendant?: string | null; legalHechos?: string | null; claimantEmail?: string | null },
  docs: FalloPartyDocument[],
): boolean {
  if (!pickFalloPrimeraDocument(docs)) return false;
  if (looksLikeSegundaMisassignedParties(caseItem.claimant, caseItem.defendant, caseItem.claimantEmail)) {
    return true;
  }
  if (!(caseItem.claimant || '').trim() || !(caseItem.defendant || '').trim()) return true;
  if (!(caseItem.legalHechos || '').trim()) return true;
  return false;
}

export function joinPartyNames(
  parties: Array<{ nombre?: string | null }>,
): string {
  return parties
    .map((p) => (p.nombre || '').trim())
    .filter(Boolean)
    .join('; ');
}

export function joinPartyField<K extends 'nombre' | 'identificacion' | 'email'>(
  parties: Array<Record<K, string | undefined | null>>,
  key: K,
): string {
  return parties
    .map((p) => (p[key] || '').trim())
    .filter(Boolean)
    .join('; ');
}
