import { describe, expect, it } from 'vitest';
import {
  looksLikeSegundaMisassignedParties,
  pickFalloPrimeraDocument,
} from './segunda-fallo-parties';
import type { Document } from '../types';

function doc(partial: Partial<Document> & { name: string }): Document {
  return {
    id: partial.id || '1',
    caseId: 'case',
    name: partial.name,
    type: partial.type || 'sgde_migrate',
    createdAt: partial.createdAt || '2026-01-01',
    ...partial,
  };
}

describe('pickFalloPrimeraDocument', () => {
  it('prefiere FalloTutela sobre otros PDF', () => {
    const docs = [
      doc({ id: 'a', name: 'CorreoReparto', type: 'email_body' }),
      doc({ id: 'b', name: 'ActaReparto' }),
      doc({ id: 'c', name: 'Fallotutel20260138210', notebookCode: 'SI_C01' }),
      doc({ id: 'd', name: '001DemandaAnexos01' }),
    ];
    expect(pickFalloPrimeraDocument(docs)?.name).toBe('Fallotutel20260138210');
  });

  it('ignora notificaciones de fallo', () => {
    const docs = [
      doc({ id: 'a', name: 'NotificacionFallo' }),
      doc({ id: 'b', name: 'ConstanciaNotifFallo' }),
    ];
    expect(pickFalloPrimeraDocument(docs)).toBeNull();
  });

  it('detecta fallo SGDE con prefijo numérico (caso 1046)', () => {
    const docs = [
      doc({ id: 'a', name: '21Notificadoautoconcedeimpugnacion02' }),
      doc({ id: 'b', name: '17Notificacionfallo24jun202617' }),
      doc({ id: 'c', name: '16Falloniega24jun2026N16' }),
      doc({ id: 'd', name: '006falloAcciNdetutelaN20600118' }),
    ];
    expect(pickFalloPrimeraDocument(docs)?.name).toBe('16Falloniega24jun2026N16');
  });
});

describe('looksLikeSegundaMisassignedParties', () => {
  it('detecta juzgado remitente como accionante', () => {
    expect(
      looksLikeSegundaMisassignedParties(
        'Juzgado 90 Pequeñas Causas Competencia Múltiple - Bogotá',
        'DESPACHO JUDICIAL',
        'j90pqccmbta@cendoj.ramajudicial.gov.co',
      ),
    ).toBe(true);
  });

  it('no marca partes reales como erróneas', () => {
    expect(
      looksLikeSegundaMisassignedParties('María Pérez', 'EPS Salud Total', 'maria@correo.com'),
    ).toBe(false);
  });
});
