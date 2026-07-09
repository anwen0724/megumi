/*
 * Top-of-window toast viewport for transient renderer notifications.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cx } from './class-names';
import { type ToastMessage, useToastStore } from './toast-store';

const toneClasses: Record<ToastMessage['tone'], string> = {
  info: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]',
  success: 'border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-text)]',
  warning: 'border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-text)]',
  error: 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-text)]',
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed left-1/2 top-4 z-[100] flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss(): void;
}) {
  useEffect(() => {
    if (toast.durationMs <= 0) {
      return undefined;
    }
    const timeout = window.setTimeout(onDismiss, toast.durationMs);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.durationMs]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg',
        toneClasses[toast.tone],
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{toast.title}</div>
          {toast.message ? (
            <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{toast.message}</div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          onClick={onDismiss}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
