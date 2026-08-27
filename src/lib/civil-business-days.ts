/**
 * Plazos civiles CGP (Ley 1564 de 2012). Días hábiles (art. 118).
 *
 * No confundir:
 * - Art. 76 = terminación del poder (no es el traslado de la demanda).
 * - Art. 318 = reposición (3 días), no apelación.
 * - Art. 431 = 5 días de **pago** en ejecutivo; no es el término de excepciones.
 * - Art. 443 = trámite de las excepciones ya propuestas (traslado 10 días al ejecutante).
 */
/** Traslado de la demanda verbal — CGP art. 369. */
export const CONTESTACION_CIVIL_BUSINESS_DAYS = 20;

/** Excepciones de mérito en ejecutivo — CGP art. 442 num. 1. */
export const EXCEPCIONES_EJECUTIVO_BUSINESS_DAYS = 10;

/**
 * Apelación contra providencia dictada fuera de audiencia / por estado — CGP art. 322.
 * En audiencia se interpone de inmediato (no corre este plazo de 3 días).
 */
export const APELACION_CIVIL_BUSINESS_DAYS = 3;

/** Pago de suma líquida tras mandamiento — CGP art. 431 (hilo paralelo al 442; no es etapa de excepciones). */
export const PAGO_EJECUTIVO_BUSINESS_DAYS = 5;
