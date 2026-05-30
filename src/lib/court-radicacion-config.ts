import { COURT_CONSTANTS } from '../constants';
import { supabase } from './supabase';
import type { CourtRadicacionConfig } from './process-definition-types';

type CourtCuiRow = {
  id: string;
  name: string | null;
  dane_code: string | null;
  entity_code: string | null;
  specialty_code: string | null;
  despacho_number: string | null;
};

/** Fallback mientras Fase 2 no lee siempre de BD (migración no aplicada o columnas vacías). */
export function defaultRadicacionConfig(courtId: string): CourtRadicacionConfig {
  return {
    courtId,
    daneCode: COURT_CONSTANTS.CITY_CODE,
    entityCode: COURT_CONSTANTS.ENTITY_CODE,
    specialtyCode: COURT_CONSTANTS.SPECIALTY_CODE,
    despachoNumber: COURT_CONSTANTS.DESPACHO_CODE,
    displayName: COURT_CONSTANTS.NAME,
  };
}

function rowToConfig(row: CourtCuiRow): CourtRadicacionConfig {
  const fallback = defaultRadicacionConfig(row.id);
  return {
    courtId: row.id,
    daneCode: (row.dane_code || '').trim() || fallback.daneCode,
    entityCode: (row.entity_code || '').trim() || fallback.entityCode,
    specialtyCode: (row.specialty_code || '').trim() || fallback.specialtyCode,
    despachoNumber: (row.despacho_number || '').trim() || fallback.despachoNumber,
    displayName: (row.name || '').trim() || fallback.displayName,
  };
}

/** CUI operativo del despacho: BD primero, COURT_CONSTANTS si falta. */
export async function fetchCourtRadicacionConfig(courtId: string): Promise<CourtRadicacionConfig> {
  const { data, error } = await supabase
    .from('courts')
    .select('id, name, dane_code, entity_code, specialty_code, despacho_number')
    .eq('id', courtId)
    .maybeSingle();

  if (error || !data) {
    console.warn('[court-radicacion-config] fallback constants:', error?.message ?? 'sin fila');
    return defaultRadicacionConfig(courtId);
  }

  return rowToConfig(data as CourtCuiRow);
}

/** Primeros 16 dígitos del radicado (territorio + entidad + especialidad + despacho + año). */
export function buildRadicacionPrefix(config: CourtRadicacionConfig, year: number): string {
  const y = String(Math.max(1998, year)).padStart(4, '0');
  return `${config.daneCode}${config.entityCode}${config.specialtyCode}${config.despachoNumber}${y}`;
}

/** Código instancia CUI (2 dígitos). */
export function instanceCodeForLevel(instanceLevel: number): string {
  if (instanceLevel >= 2) return '01';
  return '00';
}
