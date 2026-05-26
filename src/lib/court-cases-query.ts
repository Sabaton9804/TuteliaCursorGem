import { supabase } from './supabase';
import { rowToCase } from './supabase-mappers';
import { CASE_LIST_COLUMNS } from './case-list-query';
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
  courtId: string,
  orderColumn: CourtCasesOrderColumn,
  opts?: { allCourts?: boolean }
): Promise<Case[]> {
  let query = supabase.from('cases').select(CASE_LIST_COLUMNS);
  if (!opts?.allCourts) query = query.eq('court_id', courtId);
  const { data, error } = await query.order(orderColumn, { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => rowToCase(r as unknown as Record<string, unknown>));
}
