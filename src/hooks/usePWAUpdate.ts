import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  applyPwaUpdate,
  clearPwaUpdatePending,
  isUpdatePendingGrace,
  markUpdatePending,
  resetRecoveryLevel,
} from '../utils/hardAppRefresh';

const PWA_DISMISS_STORAGE_KEY = 'pwa-update-dismissed-script';
const UPDATE_CHECK_INTERVAL_MS = 60_000;
const AUTO_RETRY_MS = 800;

function isUpdateDismissed(registration: ServiceWorkerRegistration): boolean {
  try {
    const dismissed = sessionStorage.getItem(PWA_DISMISS_STORAGE_KEY);
    const waitingUrl = registration.waiting?.scriptURL;
    return Boolean(dismissed && waitingUrl && dismissed === waitingUrl);
  } catch {
    return false;
  }
}

function shouldPromptForUpdate(registration: ServiceWorkerRegistration | null | undefined): boolean {
  if (!registration?.waiting) return false;
  if (isUpdateDismissed(registration)) return false;
  if (isUpdatePendingGrace()) return false;
  return true;
}

export function usePWAUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const updateCheckIntervalRef = useRef<number | null>(null);
  const isUpdatingRef = useRef(false);
  const autoRetryDoneRef = useRef(false);

  const syncUpdateAvailability = useCallback((registration: ServiceWorkerRegistration | null | undefined) => {
    setUpdateAvailable(shouldPromptForUpdate(registration));
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let cancelled = false;

    const register = async () => {
      try {
        registerSW({
          immediate: true,
          onRegistered(registration) {
            if (cancelled) return;
            registrationRef.current = registration ?? null;

            if (updateCheckIntervalRef.current != null) {
              window.clearInterval(updateCheckIntervalRef.current);
            }

            updateCheckIntervalRef.current = window.setInterval(() => {
              registration?.update().catch((err) => {
                console.error('Error verificando actualizaciones PWA:', err);
              });
            }, UPDATE_CHECK_INTERVAL_MS);

            syncUpdateAvailability(registration);
          },
          onNeedRefresh() {
            if (cancelled) return;
            syncUpdateAvailability(registrationRef.current);
          },
          onOfflineReady() {
            /* opcional */
          },
        });
      } catch (error) {
        console.error('Error registrando service worker:', error);
      }
    };

    void register();

    const onControllerChange = () => {
      syncUpdateAvailability(registrationRef.current);
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      if (updateCheckIntervalRef.current != null) {
        window.clearInterval(updateCheckIntervalRef.current);
      }
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
    };
  }, [syncUpdateAvailability]);

  useEffect(() => {
    if (import.meta.env.DEV || !isUpdatePendingGrace()) return;

    const timer = window.setTimeout(async () => {
      if (autoRetryDoneRef.current || isUpdatingRef.current) return;
      const registration = registrationRef.current ?? (await navigator.serviceWorker.getRegistration());
      if (!registration?.waiting) return;
      autoRetryDoneRef.current = true;
      try {
        await applyPwaUpdate(registration);
      } catch (error) {
        console.error('Reintento automático de actualización PWA falló:', error);
      }
    }, AUTO_RETRY_MS);

    return () => window.clearTimeout(timer);
  }, []);

  const updateAndReload = useCallback(async () => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    setIsUpdating(true);
    setUpdateAvailable(false);
    markUpdatePending();

    try {
      sessionStorage.removeItem(PWA_DISMISS_STORAGE_KEY);
      resetRecoveryLevel();
      const registration = registrationRef.current ?? (await navigator.serviceWorker.getRegistration());
      await applyPwaUpdate(registration ?? null);
    } catch (error) {
      console.error('Error aplicando actualización PWA:', error);
      try {
        const registration = registrationRef.current ?? (await navigator.serviceWorker.getRegistration());
        await applyPwaUpdate(registration ?? null);
      } catch (retryError) {
        console.error('Reintento de actualización PWA falló:', retryError);
      }
    } finally {
      isUpdatingRef.current = false;
      setIsUpdating(false);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    const registration = registrationRef.current;
    const waitingUrl = registration?.waiting?.scriptURL;
    if (waitingUrl) {
      try {
        sessionStorage.setItem(PWA_DISMISS_STORAGE_KEY, waitingUrl);
      } catch {
        /* ignore */
      }
    }
    setUpdateAvailable(false);
  }, []);

  return {
    updateAvailable,
    isUpdating,
    updateAndReload,
    dismissUpdate,
    clearPwaUpdatePending,
  };
}
