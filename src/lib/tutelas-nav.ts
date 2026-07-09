import type { CaseType } from '../types';

export type TutelasListFilter =
  | { kind: 'tipo'; tipo: CaseType }
  | { kind: 'incidentes' }
  | { kind: 'all' };

export const TUTELAS_SUBMENU: ReadonlyArray<{
  label: string;
  filter: TutelasListFilter;
}> = [
  { label: 'Primera instancia', filter: { kind: 'tipo', tipo: 'tutela_primera' } },
  { label: 'Segunda instancia', filter: { kind: 'tipo', tipo: 'tutela_segunda' } },
  { label: 'Consultas de desacato', filter: { kind: 'tipo', tipo: 'consulta_desacato' } },
  { label: 'Incidentes de desacato', filter: { kind: 'incidentes' } },
];

export function tutelasListHref(filter: TutelasListFilter = { kind: 'all' }): string {
  const p = new URLSearchParams();
  if (filter.kind === 'tipo') p.set('tipo', filter.tipo);
  if (filter.kind === 'incidentes') p.set('incidentes', '1');
  const q = p.toString();
  return q ? `/cases?${q}` : '/cases';
}

export function parseTutelasListFilter(search: string): TutelasListFilter {
  const p = new URLSearchParams(search);
  if (p.get('incidentes') === '1' || p.get('incidentes') === 'true') {
    return { kind: 'incidentes' };
  }
  const tipo = p.get('tipo');
  if (tipo === 'tutela_primera' || tipo === 'tutela_segunda' || tipo === 'consulta_desacato') {
    return { kind: 'tipo', tipo };
  }
  return { kind: 'all' };
}

export function tutelasListPageTitle(filter: TutelasListFilter): string {
  if (filter.kind === 'incidentes') return 'Incidentes de desacato';
  if (filter.kind === 'tipo') {
    const row = TUTELAS_SUBMENU.find((s) => s.filter.kind === 'tipo' && s.filter.tipo === filter.tipo);
    return row?.label ?? 'Tutelas';
  }
  return 'Tutelas';
}

export function isTutelasRouteActive(pathname: string, search = ''): boolean {
  if (pathname === '/cases') return true;
  if (pathname.startsWith('/case/')) {
    const p = new URLSearchParams(search);
    return p.get('from') !== 'procesos';
  }
  return false;
}

export function isTutelasSubItemActive(pathname: string, search: string, filter: TutelasListFilter): boolean {
  if (pathname !== '/cases') return false;
  const current = parseTutelasListFilter(search);
  if (filter.kind === 'incidentes' && current.kind === 'incidentes') return true;
  if (filter.kind === 'tipo' && current.kind === 'tipo' && current.tipo === filter.tipo) return true;
  if (filter.kind === 'all' && current.kind === 'all') return true;
  return false;
}
