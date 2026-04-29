/** Solo defaults del formato v1 (membrete); usado por migración y plantillas-store v2. */

export type PlantillasStateV1 = {
  version: 1;
  auto: {
    line1: string;
    line2: string;
    line3: string;
  };
  informe: {
    juzgado: string;
    direccion: string;
    correo: string;
  };
  membreteImageDataUrl: string;
};

export const DEFAULT_PLANTILLAS: PlantillasStateV1 = {
  version: 1,
  auto: {
    line1: 'República de Colombia',
    line2: 'Rama Judicial del Poder Público',
    line3: 'Juzgado Cincuenta y Uno Civil del Circuito',
  },
  informe: {
    juzgado: 'Juzgado Cincuenta y Uno Civil del Circuito de Bogotá D.C.',
    direccion: 'Calle 12 No. 9 – 23, piso 4 Edificio Virrey Torre Norte',
    correo: 'j51cctobt@cendoj.ramajudicial.gov.co',
  },
  membreteImageDataUrl: '',
};
