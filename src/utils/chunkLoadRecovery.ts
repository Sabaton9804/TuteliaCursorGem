import {
  bumpRecoveryLevel,
  clearAllCaches,
  getRecoveryLevel,
  hardReloadWithCacheBust,
  resetRecoveryLevel,
  softChunkRecovery,
  unregisterAllServiceWorkers,
} from './hardAppRefresh';

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Loading chunk [\d]+ failed/i,
  /ChunkLoadError/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

let recoveryInFlight = false;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error ?? '');
}

function isChunkLoadFailure(message: string): boolean {
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function runRecovery(): Promise<void> {
  if (recoveryInFlight) return;
  recoveryInFlight = true;

  const level = bumpRecoveryLevel();

  try {
    if (level <= 1) {
      const registration = await navigator.serviceWorker.getRegistration();
      await softChunkRecovery(registration ?? null);
      return;
    }

    await unregisterAllServiceWorkers();
    await clearAllCaches();
    hardReloadWithCacheBust();
  } catch (error) {
    console.error('[chunkLoadRecovery] fallo en recuperación:', error);
    hardReloadWithCacheBust();
  } finally {
    window.setTimeout(() => {
      recoveryInFlight = false;
    }, 2_000);
  }
}

function maybeRecover(error: unknown): void {
  if (import.meta.env.DEV) return;
  const message = messageFromUnknown(error);
  if (!isChunkLoadFailure(message)) return;
  if (getRecoveryLevel() >= 2) return;
  console.warn('[chunkLoadRecovery] error de chunk detectado, intentando recuperación…', message);
  void runRecovery();
}

export function setupChunkLoadRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    maybeRecover(payload ?? 'vite:preloadError');
  });

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
        maybeRecover(event.message || 'script/link load error');
      }
    },
    true,
  );

  window.addEventListener('unhandledrejection', (event) => {
    maybeRecover(event.reason);
  });
}

export { resetRecoveryLevel };
