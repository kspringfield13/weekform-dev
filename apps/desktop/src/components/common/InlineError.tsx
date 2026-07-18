import { AlertTriangle } from "lucide-react";

/**
 * Persistent in-panel error state with an optional inline retry.
 *
 * This is the single source for AI-op error rows (classification / forecast /
 * narrative / review copilot). It is distinct from the transient toast layer
 * (`useToasts`): toasts auto-expire for app-level events, this stays put until
 * the failing op succeeds. Don't double-render both for the same error.
 */
export function InlineError({
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="error-row" role="alert">
      <p className="inline-error-text">
        <AlertTriangle size={14} aria-hidden className="inline-error-icon" />
        <span>{message}</span>
      </p>
      {onRetry && (
        <button type="button" className="error-retry" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
