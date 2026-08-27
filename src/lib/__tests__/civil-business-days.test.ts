import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APELACION_CIVIL_BUSINESS_DAYS,
  CONTESTACION_CIVIL_BUSINESS_DAYS,
  EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS,
  PAGO_EJECUTIVO_BUSINESS_DAYS,
} from '../civil-business-days';
import { stageLabelForCaseType } from '../case-workflow-stages';
import { isStaleCgpStageTerm, subStageDeadlineLabel } from '../case-stage-deadlines';

describe('plazos civiles CGP (no mezclar artículos)', () => {
  it('verbal: traslado 20 días art. 369, no art. 76', () => {
    expect(CONTESTACION_CIVIL_BUSINESS_DAYS).toBe(20);
    expect(subStageDeadlineLabel('TERMINO_RESPUESTA', 'civil_ordinario')).toMatch(/art\. 369/);
    expect(subStageDeadlineLabel('TERMINO_RESPUESTA', 'civil_ordinario')).not.toMatch(/art\. 76/);
    expect(stageLabelForCaseType('TERMINO_RESPUESTA', 'civil_ordinario')).toMatch(/art\. 369/);
  });

  it('ejecutivo: excepciones 10 días art. 442; el 5 es pago 431', () => {
    expect(EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS).toBe(10);
    expect(PAGO_EJECUTIVO_BUSINESS_DAYS).toBe(5);
    expect(stageLabelForCaseType('TERMINO_EXCEPCIONES', 'civil_ejecutivo')).toMatch(/art\. 442/);
    expect(stageLabelForCaseType('TERMINO_EXCEPCIONES', 'civil_ejecutivo')).not.toMatch(/art\. 443/);
  });

  it('apelación: 3 días art. 322, no 10 ni art. 318', () => {
    expect(APELACION_CIVIL_BUSINESS_DAYS).toBe(3);
    expect(stageLabelForCaseType('TERMINO_APELACION', 'civil_ordinario')).toMatch(/art\. 322/);
    expect(stageLabelForCaseType('TERMINO_APELACION', 'civil_ordinario')).not.toMatch(/art\. 318/);
  });

  it('tramites-cgp.json coincide con las constantes TS', () => {
    const raw = readFileSync(resolve('docs/cgp/tramites-cgp.json'), 'utf8');
    const catalog = JSON.parse(raw) as {
      id: string;
      especialidad?: string;
      plazos_canonicos: Record<string, { dias_habiles: number; cgp: string }>;
      tramites: Array<{ id: string; case_type: string; perfil: string }>;
    };
    expect(catalog.id).toBe('tramites-cgp-civil-circuito');
    expect(catalog.especialidad).toBe('civil_circuito');
    const p = catalog.plazos_canonicos;
    expect(p.contestacion_verbal).toMatchObject({ dias_habiles: CONTESTACION_CIVIL_BUSINESS_DAYS, cgp: '369' });
    expect(p.excepciones_ejecutivo).toMatchObject({ dias_habiles: EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS, cgp: '442' });
    expect(p.pago_ejecutivo).toMatchObject({ dias_habiles: PAGO_EJECUTIVO_BUSINESS_DAYS, cgp: '431' });
    expect(p.apelacion_fuera_audiencia).toMatchObject({ dias_habiles: APELACION_CIVIL_BUSINESS_DAYS, cgp: '322' });
    expect(p.reposicion.cgp).toBe('318');
    const ids = catalog.tramites.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['verbal', 'verbal_pertenencia', 'ejecutivo', 'divisorio']));
    const rawSrc = readFileSync(resolve('src/data/catalogos/tramites-cgp.json'), 'utf8');
    expect(JSON.parse(rawSrc).id).toBe(catalog.id);
  });

  it('ignora seed viejo (excepciones 5 / apelación 10) hasta aplicar SQL', () => {
    expect(isStaleCgpStageTerm('TERMINO_EXCEPCIONES', 5, 'civil_ejecutivo')).toBe(true);
    expect(isStaleCgpStageTerm('TERMINO_EXCEPCIONES', 10, 'civil_ejecutivo')).toBe(false);
    expect(isStaleCgpStageTerm('TERMINO_APELACION', 10, 'civil_ordinario')).toBe(true);
    expect(isStaleCgpStageTerm('TERMINO_APELACION', 3, 'civil_ordinario')).toBe(false);
    expect(isStaleCgpStageTerm('TERMINO_APELACION', 10, 'tutela_primera')).toBe(false);
  });
});
