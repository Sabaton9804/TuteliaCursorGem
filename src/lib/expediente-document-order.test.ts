import { describe, expect, it } from 'vitest';
import { compareExpedientePiezas, sgdeProtocolPrefixOrder, sgdeProtocolSuffixOrder } from './expediente-document-order';
import type { Document } from '../types';

describe('sgdeProtocolPrefixOrder', () => {
  it('lee el índice al inicio del nombre protocolo SGDE', () => {
    expect(sgdeProtocolPrefixOrder('02Anexos02')).toBe(2);
    expect(sgdeProtocolPrefixOrder('03Actareparto03')).toBe(3);
    expect(sgdeProtocolPrefixOrder('12Remisionoficiojuz77penalmunicipal2')).toBe(12);
    expect(sgdeProtocolPrefixOrder('21Notificadoautoconcedeimpugnacion02')).toBe(21);
  });

  it('no confunde nombres sin prefijo protocolo', () => {
    expect(sgdeProtocolPrefixOrder('Correo01.pdf')).toBeNull();
    expect(sgdeProtocolPrefixOrder('ActaReparto')).toBeNull();
  });
});

describe('sgdeProtocolSuffixOrder', () => {
  it('lee índices protocolo Correo01 / Demanda03', () => {
    expect(sgdeProtocolSuffixOrder('Correo01.pdf')).toBe(1);
    expect(sgdeProtocolSuffixOrder('Escritodemanda03')).toBe(3);
    expect(sgdeProtocolSuffixOrder('Anexo06')).toBe(6);
  });

  it('no toma horas/fechas del nombre de descarga', () => {
    expect(sgdeProtocolSuffixOrder('DEMANDA14072026_082545.pdf')).toBeNull();
    expect(sgdeProtocolSuffixOrder('EscritoDemanda')).toBeNull();
    expect(sgdeProtocolSuffixOrder('ActaReparto')).toBeNull();
  });
});

describe('compareExpedientePiezas', () => {
  const doc = (partial: Partial<Document>): Document =>
    ({
      id: partial.id ?? 'x',
      caseId: 'c',
      name: partial.name ?? 'Doc',
      originalName: partial.originalName,
      order: partial.order ?? 0,
      sgdeId: partial.sgdeId ?? 'sgde-1',
      sgdeSyncStatus: partial.sgdeSyncStatus ?? 'linked',
      type: partial.type ?? 'attachment',
    }) as Document;

  it('ordena por sort_order cuando no hay sufijo protocolo (caso civil 380)', () => {
    const correo = doc({
      id: '1',
      name: 'CorreoReparto',
      originalName: 'RV_ Generación No 1745248.eml',
      order: 0,
    });
    const acta = doc({ id: '2', name: 'ActaReparto', order: 1 });
    const escrito = doc({
      id: '3',
      name: 'EscritoDemanda',
      originalName: 'DEMANDA14072026_082545.pdf',
      order: 3,
    });
    expect(compareExpedientePiezas(correo, escrito)).toBeLessThan(0);
    expect(compareExpedientePiezas(acta, escrito)).toBeLessThan(0);
    expect([correo, escrito, acta].sort(compareExpedientePiezas).map((d) => d.name)).toEqual([
      'CorreoReparto',
      'ActaReparto',
      'EscritoDemanda',
    ]);
  });

  it('ordena piezas migradas por prefijo del índice (caso tutela 2ª)', () => {
    const names = [
      '21Notificadoautoconcedeimpugnacion02',
      '02Anexos02',
      '04Correoreparto04',
      '12Remisionoficiojuz77penalmunicipal2',
      '03Actareparto03',
    ];
    const docs = names.map((name, i) =>
      doc({ id: String(i), name, order: i, type: 'sgde_migrate' }),
    );
    expect(docs.sort(compareExpedientePiezas).map((d) => d.name)).toEqual([
      '02Anexos02',
      '03Actareparto03',
      '04Correoreparto04',
      '12Remisionoficiojuz77penalmunicipal2',
      '21Notificadoautoconcedeimpugnacion02',
    ]);
  });
});
