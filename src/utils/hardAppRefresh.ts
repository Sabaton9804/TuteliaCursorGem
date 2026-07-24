const PWA_UPDATE_PENDING_KEY = 'pwa-update-pending-at';
const RECOVERY_LEVEL_KEY = 'pwa-chunk-recovery-level';

const UPDATE_PENDING_GRACE_MS = 20_000;

export function markUpdatePending(): void {
  try {
    sessionStorage.setItem(PWA_UPDATE_PENDING_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function clearPwaUpdatePending(): void {
  try {
    sessionStorage.removeItem(PWA_UPDATE_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function isUpdatePendingGrace(): boolean {
  try {
    const raw = sessionStorage.getItem(PWA_UPDATE_PENDING_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < UPDATE_PENDING_GRACE_MS;
  } catch {
    return false;
  }
}

export function getRecoveryLevel(): number {
  try {
    return Number(sessionStorage.getItem(RECOVERY_LEVEL_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}

export function bumpRecoveryLevel(): number {
  const next = getRecoveryLevel() + 1;
  try {
    sessionStorage.setItem(RECOVERY_LEVEL_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function resetRecoveryLevel(): void {
  try {
    sessionStorage.removeItem(RECOVERY_LEVEL_KEY);
  } catch {
    /* ignore */
  }
}

function waitForControllerChange(timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker.controller) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => resolve(), timeoutMs);
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function waitForWaitingWorker(
  registration: ServiceWorkerRegistration | null | undefined,
  timeoutMs = 8_000,
): Promise<ServiceWorker | null> {
  if (registration?.waiting) return registration.waiting;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    const onUpdateFound = () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && registration?.waiting) {
          window.clearTimeout(timer);
          registration.removeEventListener('updatefound', onUpdateFound);
          resolve(registration.waiting);
        }
      });
    };
    registration?.addEventListener('updatefound', onUpdateFound);
  });
}

async function activateWaitingWorker(registration: ServiceWorkerRegistration | null | undefined): Promise<boolean> {
  const waiting = await waitForWaitingWorker(registration);
  if (!waiting) return false;

  const previousController = navigator.serviceWorker.controller;
  waiting.postMessage({ type: 'SKIP_WAITING' });

  if (previousController && previousController !== waiting) {
    await waitForControllerChange();
  }
  return true;
}

/** Activa el SW en espera y recarga la página con el bundle nuevo. */
export async function applyPwaUpdate(registration?: ServiceWorkerRegistration | null): Promise<void> {
  if ('serviceWorker' in navigator) {
    const reg = registration ?? (await navigator.serviceWorker.getRegistration());
    // No vaciar caches antes de activar — Workbox cleanupOutdatedCaches limpia lo viejo al tomar control.
    await activateWaitingWorker(reg ?? null);
  }
  window.location.reload();
}

/** Recuperación suave tras error de chunk: activa SW, limpia caches y recarga con bust. */
export async function softChunkRecovery(registration?: ServiceWorkerRegistration | null): Promise<void> {
  if ('serviceWorker' in navigator) {
    const reg = registration ?? (await navigator.serviceWorker.getRegistration());
    await activateWaitingWorker(reg ?? null);
  }
  await clearAllCaches();
  hardReloadWithCacheBust();
}

export async function clearAllCaches(): Promise<void> {
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

export async function unregisterAllServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((reg) => reg.unregister()));
}

/** Recarga con query anti-caché del HTML. */
export function hardReloadWithCacheBust(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('__refresh', String(Date.now()));
  window.location.replace(url.toString());
}
