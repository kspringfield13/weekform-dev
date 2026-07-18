import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

export interface Toast extends ToastInput {
  id: string;
}

export type PushToast = (input: ToastInput) => void;

// Cap the visible stack so a burst of events can never overflow the viewport, and
// auto-expire each toast after a few seconds (manual close stays available).
const MAX_TOASTS = 4;
const AUTO_DISMISS_MS = 5000;

/**
 * Lightweight, in-memory toast queue. State lives at the App level (single source
 * of truth) and `pushToast` is threaded down to the few call sites that need
 * transient app-level feedback. Returns a stable `pushToast`/`dismissToast` so the
 * pair can sit in effect dependency arrays without re-firing.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback<PushToast>(
    (input) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => {
        const next = [...current, { ...input, id }];
        // Cap the stack and clear the pending timer of every evicted toast so no
        // orphan entry lingers in the timers Map. clearTimeout/delete are
        // idempotent, so a StrictMode double-invoke of this updater is harmless.
        while (next.length > MAX_TOASTS) {
          const [evicted] = next.splice(0, 1);
          const timer = timers.current.get(evicted.id);
          if (timer !== undefined) {
            window.clearTimeout(timer);
            timers.current.delete(evicted.id);
          }
        }
        return next;
      });
      const timer = window.setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
      timers.current.set(id, timer);
    },
    [dismissToast]
  );

  // Clear any pending timers on unmount so they can't fire after teardown.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return { toasts, pushToast, dismissToast };
}
