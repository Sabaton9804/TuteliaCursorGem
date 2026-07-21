import type { CaseNavScope } from './case-process-scope';

export type ProcesosCivilesListFilter = {
  tipoProceso: string | 'all';
  situacion: string | 'all';
  encargado: string | 'all';
  regimen: string | 'all';
};

export type ProcesosEstadoListFilter = ProcesosCivilesListFilter & {
  terminado: 'all' | 'si' | 'no';
  etapa: string | 'all';
  ubicacion: string | 'all';
};

export const PROCESOS_SUBMENU: ReadonlyArray<{
  label: string;
  path: string;
}> = [
  { label: 'Inicio', path: '/procesos' },
  { label: 'Catálogo civil', path: '/procesos/civiles' },
  { label: 'Estado por proceso', path: '/procesos/estado' },
];

export function procesosCivilesHref(filter: Partial<ProcesosCivilesListFilter> = {}): string {
  const p = new URLSearchParams();
  if (filter.tipoProceso && filter.tipoProceso !== 'all') p.set('tipo', filter.tipoProceso);
  if (filter.situacion && filter.situacion !== 'all') p.set('situacion', filter.situacion);
  if (filter.encargado && filter.encargado !== 'all') p.set('encargado', filter.encargado);
  if (filter.regimen && filter.regimen !== 'all') p.set('regimen', filter.regimen);
  const q = p.toString();
  return q ? `/procesos/civiles?${q}` : '/procesos/civiles';
}

export function parseProcesosCivilesFilter(search: string): ProcesosCivilesListFilter {
  const p = new URLSearchParams(search);
  return {
    tipoProceso: p.get('tipo')?.trim() || 'all',
    situacion: p.get('situacion')?.trim() || 'all',
    encargado: p.get('encargado')?.trim() || 'all',
    regimen: p.get('regimen')?.trim() || 'all',
  };
}

export function parseProcesosEstadoFilter(search: string): ProcesosEstadoListFilter {
  const base = parseProcesosCivilesFilter(search);
  const p = new URLSearchParams(search);
  const terminado = p.get('terminado')?.trim();
  return {
    ...base,
    terminado: terminado === 'si' || terminado === 'no' ? terminado : 'all',
    etapa: p.get('etapa')?.trim() || 'all',
    ubicacion: p.get('ubicacion')?.trim() || 'all',
  };
}

export function procesosEstadoFilterParamKey(
  key: keyof ProcesosEstadoListFilter,
): string {
  if (key === 'tipoProceso') return 'tipo';
  return key;
}

function caseDetailIsProcesosScope(search: string, caseNavScope?: CaseNavScope | null): boolean {
  if (caseNavScope === 'procesos') return true;
  if (caseNavScope === 'tutelas') return false;
  return new URLSearchParams(search).get('from') === 'procesos';
}

export function isProcesosRouteActive(pathname: string, search = '', caseNavScope?: CaseNavScope | null): boolean {
  if (pathname === '/procesos' || pathname.startsWith('/procesos/')) return true;
  if (pathname.startsWith('/case/')) {
    return caseDetailIsProcesosScope(search, caseNavScope);
  }
  return false;
}

export function isProcesosSubItemActive(
  pathname: string,
  path: string,
  search = '',
  caseNavScope?: CaseNavScope | null,
): boolean {
  if (pathname.startsWith('/case/')) {
    return path === '/procesos/civiles' && caseDetailIsProcesosScope(search, caseNavScope);
  }
  if (path === '/procesos') return pathname === '/procesos';
  return pathname === path || pathname.startsWith(`${path}/`);
}
