import type { CaseType } from '../types';
import catalogRaw from '../data/catalogos/actuaciones-tutela.json';

export type ActuacionCatalogScope = CaseType | 'general';

export type ActuacionCatalogEntry = {
  label: string;
  scope: ActuacionCatalogScope[];
};

const CATALOG_ENTRIES: ActuacionCatalogEntry[] = (
  catalogRaw as { entries?: ActuacionCatalogEntry[] }
).entries?.filter((e) => typeof e.label === 'string' && e.label.trim()) ?? [];

/** Actuaciones frecuentes mostradas como acceso rápido en la UI. */
export const ACTUACIONES_RAPIDAS: readonly string[] = [
  'Auto admite tutela',
  'Auto de pruebas Tutela',
  'Al despacho para sentencia',
  'Resuelve Incidente de Desacato',
  'Remite por competencia Tutela',
  'Al despacho',
  'Agreguese a autos',
  'Auto admite consulta',
] as const;

export function listActuacionesCatalog(scope?: CaseType | null): ActuacionCatalogEntry[] {
  if (!scope) return [...CATALOG_ENTRIES];
  return CATALOG_ENTRIES.filter((e) => e.scope.includes(scope) || e.scope.includes('general'));
}

export function searchActuacionesCatalog(query: string, scope?: CaseType | null, limit = 12): string[] {
  const q = query.trim().toLowerCase();
  const pool = listActuacionesCatalog(scope).map((e) => e.label);
  if (!q) return pool.slice(0, limit);
  const scored = pool
    .map((label) => {
      const lower = label.toLowerCase();
      if (lower === q) return { label, score: 0 };
      if (lower.startsWith(q)) return { label, score: 1 };
      if (lower.includes(q)) return { label, score: 2 };
      return null;
    })
    .filter((x): x is { label: string; score: number } => x != null)
    .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, 'es'));
  return scored.slice(0, limit).map((x) => x.label);
}

export function actuacionesCatalogCount(): number {
  return CATALOG_ENTRIES.length;
}
