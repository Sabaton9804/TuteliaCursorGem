import { describe, expect, it } from 'vitest';
import type { Document } from '../../types';
import { actCatalogForCaseType, inferActCodeFromDocument } from '../case-act-types';
import { canRegistrarIngresoDespachoParaSentencia } from '../case-stage-act-gates';
import { resolveCgpTramite, requiredActsBeforeStage } from '../tramites-cgp';

function doc(name: string): Document {
  return {
    id: name,
    caseId: 'c1',
    type: 'pdf',
    name,
    url: '',
    createdAt: new Date().toISOString(),
  };
}

describe('trámite + perfil CGP (civil circuito, nacional)', () => {
  it('SIERJU pertenencia es verbal con perfil 375, no case_type nuevo', () => {
    const r = resolveCgpTramite({
      caseType: 'civil_ordinario',
      sierjuClassCode: 'declarativos_verbal_pertenencia',
    });
    expect(r).toMatchObject({ id: 'verbal_pertenencia', caseType: 'civil_ordinario', tramite: 'verbal', perfil: '375' });
  });

  it('infiere pertenencia desde etiqueta SIERJU en tipo_proceso', () => {
    const r = resolveCgpTramite({
      caseType: 'civil_ordinario',
      tipoProceso: 'DECLARATIVOS VERBAL PERTENENCIA',
    });
    expect(r?.perfil).toBe('375');
  });

  it('RC y verbal genérico no exigen inspección', () => {
    const r = resolveCgpTramite({
      caseType: 'civil_ordinario',
      sierjuClassCode: 'rc_contractual',
    });
    expect(r?.perfil).toBe('ninguno');
    expect(requiredActsBeforeStage(r, 'FALLO')).toEqual([]);
    expect(canRegistrarIngresoDespachoParaSentencia('civil_ordinario', [], { sierjuClassCode: 'rc_contractual' }).ok).toBe(
      true,
    );
  });

  it('pertenencia bloquea ingreso a sentencia sin acta 375 num. 9', () => {
    const opts = { sierjuClassCode: 'declarativos_verbal_pertenencia' };
    const blocked = canRegistrarIngresoDespachoParaSentencia('civil_ordinario', [], opts);
    expect(blocked.ok).toBe(false);
    if (blocked.ok === false) expect(blocked.missingActs).toContain('acta_inspeccion_judicial');

    const ok = canRegistrarIngresoDespachoParaSentencia(
      'civil_ordinario',
      [doc('ActaInspeccionJudicial.pdf')],
      opts,
    );
    expect(ok.ok).toBe(true);
  });

  it('divisorio y servidumbre son overlay verbal, no tubo nuevo', () => {
    expect(resolveCgpTramite({ caseType: 'civil_ordinario', sierjuClassCode: 'declarativos_especiales_divisorio' })).toMatchObject({
      id: 'divisorio',
      perfil: '406',
      tramite: 'verbal',
    });
    expect(resolveCgpTramite({ caseType: 'civil_ordinario', sierjuClassCode: 'declarativos_verbal_servidumbres' })).toMatchObject({
      id: 'verbal_servidumbre',
      perfil: '376',
    });
  });

  it('catálogo overlay: inspección solo en pertenencia', () => {
    const rc = actCatalogForCaseType('civil_ordinario', { sierjuClassCode: 'rc_extracontractual' });
    expect(rc.some((a) => a.code === 'acta_inspeccion_judicial')).toBe(false);
    expect(rc.some((a) => a.code === 'acta_372')).toBe(true);

    const per = actCatalogForCaseType('civil_ordinario', { sierjuClassCode: 'declarativos_verbal_pertenencia' });
    expect(per.some((a) => a.code === 'acta_inspeccion_judicial')).toBe(true);
  });

  it('infiere ActaInspeccionJudicial y no la confunde con ActaAudiencia', () => {
    expect(inferActCodeFromDocument(doc('ActaInspeccionJudicial.pdf'))).toBe('acta_inspeccion_judicial');
    expect(inferActCodeFromDocument(doc('ActaAudienciaInicial.pdf'))).toBe('acta_372');
    expect(inferActCodeFromDocument(doc('ActaAudiencia.pdf'))).toBe('acta_audiencia');
  });
});
