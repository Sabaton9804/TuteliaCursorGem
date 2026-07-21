import { describe, expect, it } from 'vitest';
import {
  inferActCodeForSgdeTipo,
  tipoDocumentalSgdeFromFileName,
  uploadOrderPriority,
} from './sgde-tutela-metadata';

describe('tipoDocumentalSgdeFromFileName', () => {
  it('mapea informe de ingreso a Ingreso a despacho (1ª instancia)', () => {
    expect(tipoDocumentalSgdeFromFileName('InformeIngresoDespacho.pdf')).toBe('Ingreso a despacho');
    expect(
      tipoDocumentalSgdeFromFileName('x.pdf', 'informe_ingreso_expediente', 'informe_ingreso'),
    ).toBe('Ingreso a despacho');
  });

  it('no confunde AnexosDemanda con Demanda', () => {
    expect(tipoDocumentalSgdeFromFileName('AnexosDemanda.pdf')).toBe('Anexos');
    expect(tipoDocumentalSgdeFromFileName('EscritoDemanda.pdf')).toBe('Demanda');
  });

  it('usa act_code del catálogo cuando existe', () => {
    expect(tipoDocumentalSgdeFromFileName('foo.pdf', undefined, 'correo_reparto')).toBe(
      'Correo de reparto',
    );
    expect(tipoDocumentalSgdeFromFileName('foo.pdf', undefined, 'auto_admite')).toBe(
      'Auto admisorio',
    );
  });
});

describe('uploadOrderPriority', () => {
  it('ordena informe después de demanda', () => {
    expect(uploadOrderPriority('CorreoReparto', 'email_body')).toBeLessThan(
      uploadOrderPriority('InformeIngresoDespacho'),
    );
    expect(uploadOrderPriority('EscritoDemanda')).toBeLessThan(
      uploadOrderPriority('InformeIngresoDespacho'),
    );
  });
});

describe('inferActCodeForSgdeTipo', () => {
  it('infiere anexos e informe', () => {
    expect(inferActCodeForSgdeTipo('AnexosDemanda')).toBe('anexos_pruebas');
    expect(inferActCodeForSgdeTipo('InformeIngresoDespacho')).toBe('informe_ingreso');
  });
});
