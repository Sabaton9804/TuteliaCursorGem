import type { ClassifyJudicialEmailResult } from './classify-judicial-email';

function sanitizePartyEntityForFilename(entity: string): string {
  const cleaned = entity
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 28);
  return cleaned || 'Accionado';
}

export type IngestActPieceKind = 'email_body' | 'attachment';

export type IngestActMetadata = {
  act_code: string;
  source_channel: 'correo';
  party_entity?: string;
  logicalBaseName: string;
};

export function ingestActMetadataForPiece(
  classification: ClassifyJudicialEmailResult,
  kind: IngestActPieceKind,
): IngestActMetadata | null {
  if (classification.tipo !== 'respuesta_tramite') return null;

  const party = classification.accionado?.trim() || classification.descripcion_breve?.trim() || '';
  const partyEntity = party || undefined;

  if (kind === 'email_body') {
    const y = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return {
      act_code: 'correo_contestacion',
      source_channel: 'correo',
      party_entity: partyEntity,
      logicalBaseName: `CorreoContestacion${y}`,
    };
  }

  const entityPart = partyEntity ? sanitizePartyEntityForFilename(partyEntity) : 'Accionado';
  return {
    act_code: 'respuesta_accionado',
    source_channel: 'correo',
    party_entity: partyEntity,
    logicalBaseName: `Respuesta${entityPart}`,
  };
}
