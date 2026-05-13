/** Tipos compartidos del flujo de radicación (NewCase y subcomponentes). */
export interface LegalParty {
  nombre: string;
  identificacion: string;
  email: string;
}

export interface LegalAnalysis {
  accionantes: LegalParty[];
  accionados: LegalParty[];
  derechoTutelado: string;
  hechos: string;
  pretensiones: string;
}
