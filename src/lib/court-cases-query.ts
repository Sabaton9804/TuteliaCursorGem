import { supabase } from './supabase';
import { rowToCase } from './supabase-mappers';
import { CASE_LIST_COLUMNS, CASE_PROCESOS_LIST_COLUMNS } from './case-list-query';
import type { Case } from '../types';

/** Columna PostgREST para `.order()` en listados por despacho. */
export type CourtCasesOrderColumn = 'updated_at' | 'created_at' | 'radicado';

/** Tiempo en que los datos se consideran frescos (navegación entre vistas reutiliza caché). */
export const COURT_CASES_STALE_MS = 90_000;

export const courtCasesQueryRootKey = ['court-cases'] as const;

export function courtCasesQueryKey(courtId: string, order: CourtCasesOrderColumn) {
  return [...courtCasesQueryRootKey, courtId, order] as const;
}

/** Alineado con el selector de orden en Expedientes (`sortBy`). */
export function casesListSortToOrderColumn(sort: 'updated' | 'created' | 'radicado'): CourtCasesOrderColumn {
  if (sort === 'created') return 'created_at';
  if (sort === 'radicado') return 'radicado';
  return 'updated_at';
}

export async function fetchCourtCasesForList(
  courtId: string | null | undefined,
  orderColumn: CourtCasesOrderColumn
): Promise<Case[]> {
  if (!courtId?.trim()) return [];
  const { data, error } = await supabase
    .from('cases')
    .select(CASE_LIST_COLUMNS)
    .eq('court_id', courtId)
    .order(orderColumn, { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => rowToCase(r as unknown as Record<string, unknown>));
}

/** Catálogo operativo (Procesos): trae catalog_metadata para situación/trámite. */
export async function fetchCourtCasesForProcesosList(
  courtId: string | null | undefined,
  orderColumn: CourtCasesOrderColumn
): Promise<Case[]> {
  if (!courtId?.trim()) return [];
  const { data, error } = await supabase
    .from('cases')
    .select(CASE_PROCESOS_LIST_COLUMNS)
    .eq('court_id', courtId)
    .order(orderColumn, { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => rowToCase(r as unknown as Record<string, unknown>));
}
