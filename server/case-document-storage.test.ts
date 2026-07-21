import { describe, expect, it } from 'vitest';
import { ensureSinglePdfExtension, sanitizeCaseDocumentLogicalName } from './case-document-storage';

describe('ensureSinglePdfExtension / sanitizeCaseDocumentLogicalName', () => {
  it('no duplica .pdf sobre InformeIngresoDespacho.pdf', () => {
    expect(ensureSinglePdfExtension('InformeIngresoDespacho.pdf')).toBe('InformeIngresoDespacho.pdf');
    expect(sanitizeCaseDocumentLogicalName('InformeIngresoDespacho.pdf', 'documento.pdf')).toBe(
      'InformeIngresoDespacho.pdf'
    );
  });

  it('colapsa .pdf.pdf (bug de upload a SGDE)', () => {
    expect(ensureSinglePdfExtension('InformeIngresoDespacho.pdf.pdf')).toBe('InformeIngresoDespacho.pdf');
    expect(sanitizeCaseDocumentLogicalName('InformeIngresoDespacho.pdf.pdf', 'x.pdf')).toBe(
      'InformeIngresoDespacho.pdf'
    );
  });

  it('añade .pdf si falta', () => {
    expect(ensureSinglePdfExtension('InformeIngresoDespacho')).toBe('InformeIngresoDespacho.pdf');
    expect(sanitizeCaseDocumentLogicalName('CorreoReparto', 'documento.pdf')).toBe('CorreoReparto.pdf');
  });
});
