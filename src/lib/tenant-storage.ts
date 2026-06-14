/** Despacho activo en modo "operar como" (platform admin). */
export const VIEW_AS_COURT_STORAGE_KEY = 'tutelia:viewAsCourtId';

export function getViewAsCourtIdFromStorage(): string | null {
  try {
    const raw = localStorage.getItem(VIEW_AS_COURT_STORAGE_KEY)?.trim();
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function setViewAsCourtIdInStorage(courtId: string | null): void {
  try {
    if (!courtId?.trim()) {
      localStorage.removeItem(VIEW_AS_COURT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(VIEW_AS_COURT_STORAGE_KEY, courtId.trim());
  } catch {
    /* ignore */
  }
}

export const TENANT_SCOPE_CHANGED_EVENT = 'tutelia:tenant-scope-changed';

export function dispatchTenantScopeChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TENANT_SCOPE_CHANGED_EVENT));
  }
}
