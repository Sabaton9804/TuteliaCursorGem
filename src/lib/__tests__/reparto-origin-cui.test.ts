import { describe, expect, it } from 'vitest';
import {
  buildOriginCuiFromReparto,
  detectRemittingCourt,
  isPlausibleBogotaTutelaCui,
  parseRepartoInternalRef,
  resolveOriginRadicadoFromRepartoEmail,
} from '../reparto-origin-cui';

describe('parseRepartoInternalRef', () => {
  it('parsea forma No. con instancia', () => {
    expect(parseRepartoInternalRef('No. 034 – 2026 – 00545– 00')).toEqual({
      despachoHint: '034',
      year: '2026',
      consecutivo: '00545',
      instance: '00',
    });
  });

  it('parsea forma corta 090-2026-01382', () => {
    expect(
      parseRepartoInternalRef('RE: AUTO CONCEDE IMPUGNACION DE TUTELA 090-2026-01382')
    ).toEqual({
      despachoHint: '090',
      year: '2026',
      consecutivo: '01382',
      instance: '00',
    });
  });
});

describe('detectRemittingCourt', () => {
  it('detecta Pequeñas Causas por correo pqccm', () => {
    const court = detectRemittingCourt(
      'De: Juzgado 90 <j90pqccmbta@cendoj.ramajudicial.gov.co>'
    );
    expect(court?.kind).toBe('pequenas_causas');
    expect(court?.despachoCode).toBe('090');
  });

  it('prioriza despacho del asunto frente al superior del hilo', () => {
    const text = `
      Juzgado 51 Civil Circuito - Bogotá <j51cctobt@cendoj.ramajudicial.gov.co>
      JUZGADO 90 DE PEQUEÑAS CAUSAS Y COMPETENCIA MÚLTIPLE DE BOGOTÁ D.C.
      j90pqccmbta@cendoj.ramajudicial.gov.co
    `;
    const court = detectRemittingCourt(text, { preferredDespachoCode: '090' });
    expect(court?.kind).toBe('pequenas_causas');
    expect(court?.despachoCode).toBe('090');
  });
});

describe('buildOriginCuiFromReparto / resolve', () => {
  it('arma CUI 41-89 para Pequeñas Causas', () => {
    const cui = buildOriginCuiFromReparto(
      { despachoHint: '090', year: '2026', consecutivo: '01382', instance: '00' },
      {
        kind: 'pequenas_causas',
        despachoCode: '090',
        label: 'Juzgado 90 de Pequeñas Causas y Competencia Múltiple de Bogotá',
      }
    );
    expect(cui).toBe('11001418909020260138200');
    expect(isPlausibleBogotaTutelaCui(cui)).toBe(true);
  });

  it('resuelve el .eml típico AUTO CONCEDE + remisión del 90 al 51', () => {
    const subject = 'RE: AUTO CONCEDE IMPUGNACION DE TUTELA 090-2026-01382';
    const body = `
      De: Juzgado 90 Pequeñas Causas Competencia Múltiple - Bogotá
      <j90pqccmbta@cendoj.ramajudicial.gov.co>
      Para: Juzgado 51 Civil Circuito - Bogotá <j51cctobt@cendoj.ramajudicial.gov.co>
      ASIGNACIÓN REPARTO SECUENCIA: 27603
      Se remite a través del SGDE para lo que en derecho corresponda.
      JUZGADO 90 DE PEQUEÑAS CAUSAS Y COMPETENCIA MÚLTIPLE DE BOGOTÁ D.C.
    `;
    const resolved = resolveOriginRadicadoFromRepartoEmail(subject, body);
    expect(resolved.source).toBe('built');
    expect(resolved.originRadicado).toBe('11001418909020260138200');
    expect(resolved.originCourt).toMatch(/Pequeñas Causas/i);
  });

  it('acepta CUI explícito de Pequeñas Causas', () => {
    const resolved = resolveOriginRadicadoFromRepartoEmail(
      'Tutela',
      'ACCIÓN DE TUTELA: 11001418902320240005700'
    );
    expect(resolved.originRadicado).toBe('11001418902320240005700');
    expect(resolved.source).toBe('explicit');
  });
});
