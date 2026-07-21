import { describe, expect, it } from 'vitest';
import {
  informeIngresoVariablesOrigenSegunda,
  mapaVariablesDesdeCaso,
  textoInformeIngresoBorrador,
} from './plantilla-variables';
import type { Case } from '../types';
import type { PlantillasStateV2 } from './plantillas-store';

function caseSegunda(partial: Partial<Case> = {}): Case {
  return {
    id: '1',
    courtId: 'court-1',
    radicado: '11001418909020260138201',
    claimant: 'MORA WALLES HILDARDO',
    defendant: 'ALIANSALUD EPS y otros',
    status: 'received',
    sourceChannel: 'email',
    subject: 'Traslado impugnación',
    createdAt: '2026-07-20',
    updatedAt: '2026-07-20',
    caseType: 'tutela_segunda',
    originCourt: 'Juzgado 90 Pequeñas Causas Competencia Múltiple - Bogotá',
    originRadicado: '11001418909020260138200',
    originRuling: 'concedio',
    appellant: 'accionado',
    legalDerechoTutelado: 'DERECHO DE PETICIÓN',
    ...partial,
  };
}

const membreteMin: PlantillasStateV2['membrete'] = {
  auto: { line1: 'República', line2: 'Colombia', line3: '' },
  informe: {
    juzgado: 'Juzgado 51 Civil del Circuito de Bogotá D.C.',
    direccion: 'Calle 12',
    correo: 'j51@test.gov.co',
  },
};

describe('informeIngresoVariablesOrigenSegunda', () => {
  it('arma cláusula con juzgado, radicado y sentido del fallo', () => {
    const v = informeIngresoVariablesOrigenSegunda(caseSegunda());
    expect(v.juzgadoOrigen).toMatch(/Juzgado 90/);
    expect(v.radicadoOrigen).toBe('—');
    expect(v.falloOrigenSentido).toBe('concedió la tutela');
    expect(v.impugnante).toBe('el accionado');
    expect(v.clausulaOrigen).toMatch(/impugnación del fallo de primera instancia/);
    expect(v.clausulaOrigen).toMatch(/Juzgado 90/);
    expect(v.clausulaOrigen).toMatch(/concedió la tutela/);
    expect(v.clausulaOrigen).not.toMatch(/01382-00/);
  });

  it('menciona radicado de origen solo si difiere del CUI actual', () => {
    const v = informeIngresoVariablesOrigenSegunda(
      caseSegunda({
        radicado: '11001418909020260138201',
        originRadicado: '11001418902320240005700',
      }),
    );
    expect(v.clausulaOrigen).toMatch(/2024-00057/);
  });
});

describe('textoInformeIngresoBorrador tutela_segunda', () => {
  it('menciona juzgado de primera instancia en el párrafo', () => {
    const m: PlantillasStateV2 = { membrete: membreteMin, plantillas: {} };
    const texto = textoInformeIngresoBorrador(caseSegunda(), m);
    expect(texto).toMatch(/Juzgado 90/);
    expect(texto).toMatch(/concedió la tutela/);
    expect(texto).toMatch(/MORA WALLES HILDARDO/);
    const matches = texto.match(/11001-41-89-090-2026-01382-\d{2}/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('expone marcadores de origen en el mapa', () => {
    const mapa = mapaVariablesDesdeCaso(caseSegunda(), membreteMin, 'informe_ingreso');
    expect(mapa.JUZGADO_ORIGEN).toMatch(/Juzgado 90/);
    expect(mapa.RADICADO_ORIGEN).toBe('—');
  });
});
