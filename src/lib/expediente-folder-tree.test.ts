import { describe, expect, it } from 'vitest';
import { flattenSgdePathSegmentsForDisplay } from './expediente-folder-tree';

describe('flattenSgdePathSegmentsForDisplay', () => {
  it('omite carpeta numerada que envuelve EXPEDIENTE', () => {
    const segments = [
      'Primera instancia',
      '14. Respuesta a solicitud de medidas cautelares',
      'EXPEDIENTE JUZGADO 49',
      'Principal',
    ];
    expect(flattenSgdePathSegmentsForDisplay(segments)).toEqual([
      'Primera instancia',
      'EXPEDIENTE JUZGADO 49',
      'Principal',
    ]);
  });

  it('deja rutas normales sin cambios', () => {
    const segments = ['Segunda instancia', 'Impugnación'];
    expect(flattenSgdePathSegmentsForDisplay(segments)).toEqual(segments);
  });
});
