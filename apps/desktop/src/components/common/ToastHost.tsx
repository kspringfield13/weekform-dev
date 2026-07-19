import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { Toast, ToastTone } from "../../hooks/useToasts";

const TONE_ICON: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

/**
 * Renders the active toast stack with per-tone live regions: errors announce
 * assertively, while success and informational feedback remain polite.
 */
export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toast-host">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone];
        return (
          <div
            className={`toast toast-${toast.tone}${toast.leaving ? " toast-leaving" : ""}`}
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "error" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <Icon className="toast-icon" size={16} aria-hidden="true" />
            <span className="toast-message">
              {toast.tone === "error" && <span className="sr-only">Error: </span>}
              {toast.message}
            </span>
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
