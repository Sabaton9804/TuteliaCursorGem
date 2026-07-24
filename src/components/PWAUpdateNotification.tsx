import { RefreshCw } from 'lucide-react';

interface PWAUpdateNotificationProps {
  onUpdate: () => void;
  onDismiss?: () => void;
  isUpdating?: boolean;
}

export default function PWAUpdateNotification({
  onUpdate,
  onDismiss,
  isUpdating = false,
}: PWAUpdateNotificationProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-card"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <RefreshCw className={`h-4 w-4 ${isUpdating ? 'animate-spin' : ''}`} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Nueva versión disponible</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Hay una actualización de Jurion lista. Puedes aplicarla ahora o seguir trabajando y hacerlo más tarde.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onUpdate}
              disabled={isUpdating}
              className="btn-primary px-4 py-2 text-xs disabled:cursor-not-allowed"
            >
              {isUpdating ? 'Actualizando…' : 'Actualizar ahora'}
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                disabled={isUpdating}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Más tarde
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
