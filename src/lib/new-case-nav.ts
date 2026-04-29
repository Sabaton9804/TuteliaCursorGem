/**
 * Al ir a «Nueva Tutela» desde el menú se debe empezar en blanco (no restaurar el borrador de una tutela ya radicada o anterior).
 * - Otra ruta → sessionStorage, consumido al montar `/new`.
 * - Ya en `/new` → evento (misma ruta no remonta el componente).
 */
export const NEW_CASE_FRESH_NAV_FLAG = 'tutelia_fresh_new_case_nav';
export const NEW_CASE_FRESH_EVENT = 'tutelia:new-case-fresh';

export function intentFreshNewCaseFromMenu(alreadyOnNewRoute: boolean): void {
  if (alreadyOnNewRoute) {
    window.dispatchEvent(new Event(NEW_CASE_FRESH_EVENT));
    return;
  }
  sessionStorage.setItem(NEW_CASE_FRESH_NAV_FLAG, '1');
}
