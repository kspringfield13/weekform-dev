import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { Toast, ToastTone } from "../../hooks/useToasts";

const TONE_ICON: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

/**
 * Renders the active toast stack as a single polite live region. Mounted once in
 * `AppShell`; the region is always present in the DOM (even when empty) so screen
 * readers observe additions. The slide-in animation is auto-zeroed by the global
 * `prefers-reduced-motion` reset in `styles.css`.
 */
export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone];
        return (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <Icon className="toast-icon" size={16} aria-hidden="true" />
            <span className="toast-message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
