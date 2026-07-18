import { ChevronRight, RefreshCw } from "lucide-react";
import type {
  ActiveWindowSample,
  ActivitySession,
  VisualContextInsight
} from "../../../../../packages/domain/src/models";
import { InlineError } from "../common/InlineError";
import { summarizeRecentSessions } from "../../lib/blocks";
import { formatCount, formatDurationMinutes } from "../../lib/format";

export function ActivityCapturePanel({
  activeWindowSamples,
  activeWindowSessions,
  visualContextInsights,
  captureError,
  classificationStatus,
  classificationError,
  visualContextStatus,
  visualContextError,
  unclassifiedSessionCount,
  paused,
  onClassifySessions
}: {
  activeWindowSamples: ActiveWindowSample[];
  activeWindowSessions: ActivitySession[];
  visualContextInsights: VisualContextInsight[];
  captureError: string | null;
  classificationStatus: "idle" | "classifying" | "error";
  classificationError: string | null;
  visualContextStatus: "idle" | "capturing" | "error";
  visualContextError: string | null;
  unclassifiedSessionCount: number;
  paused: boolean;
  onClassifySessions: () => void;
}) {
  const latestSample = activeWindowSamples[activeWindowSamples.length - 1];
  const latestSessionSummaries = summarizeRecentSessions(activeWindowSessions);
  // Explain the disabled button when it's disabled purely because there's nothing to classify
  // (not mid-classify) — otherwise a fully-classified ledger reads as a broken gray button.
  // Distinguish a true first run (nothing ever captured) from a fully-classified ledger:
  // "All sessions classified" would falsely assert a classification that never happened.
  const nothingToClassify = classificationStatus !== "classifying" && unclassifiedSessionCount === 0;
  const classifyDisabledReason = nothingToClassify
    ? activeWindowSessions.length === 0
      ? "No sessions captured yet — resume tracking to collect activity"
      : "All sessions classified"
    : undefined;
  // Capture is a categorical state (active / paused / error), not a percentage —
  // surface it as a plain status pill rather than a classification-style confidence chip.
  const captureState = captureError
    ? { tone: "error", label: "Capture error" }
    : paused
      ? { tone: "paused", label: "Paused" }
      : { tone: "active", label: "Capturing" };

  return (
    <details className="activity-capture-panel">
      <summary className="ledger-disclosure-summary">
        <div className="ledger-disclosure-main">
          <ChevronRight className="ledger-disclosure-caret" size={16} aria-hidden="true" />
          <div className="ledger-disclosure-heading">
            <span className="ledger-disclosure-title">Live local capture</span>
            <span className="ledger-disclosure-subtitle">
              {paused ? "Capture paused" : "Foreground app and window metadata stored locally"}
            </span>
          </div>
        </div>
        <div className="capture-actions">
          <button
            className={`secondary-action classify-sessions-action${classificationStatus === "classifying" ? " is-classifying" : ""}`}
            type="button"
            disabled={classificationStatus === "classifying" || unclassifiedSessionCount === 0}
            title={classifyDisabledReason}
            aria-label={classifyDisabledReason}
            aria-busy={classificationStatus === "classifying"}
            onClick={(e) => { e.stopPropagation(); onClassifySessions(); }}
          >
            <RefreshCw
              key={classificationStatus === "classifying" ? "classifying" : "idle"}
              className="classify-sessions-icon"
              size={16}
              aria-hidden
            />
            <span>{classificationStatus === "classifying" ? "Classifying…" : "Classify sessions"}</span>
          </button>
          <span className={`capture-status-pill capture-status-pill--${captureState.tone}`}>
            {captureState.label}
          </span>
        </div>
      </summary>
      {classificationStatus === "classifying" && (
        <p className="capture-note">
          Sending {formatCount(unclassifiedSessionCount)} ready session{unclassifiedSessionCount === 1 ? "" : "s"} to your AI provider…
        </p>
      )}
      {classificationError && <InlineError message={classificationError} onRetry={onClassifySessions} />}
      <div className="capture-grid">
        <div className="capture-stat">
          <span>Current app</span>
          <strong>{paused ? "Paused" : latestSample?.app_name ?? "Waiting"}</strong>
          <small>{latestSample?.window_title ?? "No active-window sample yet"}</small>
        </div>
        <div className="capture-stat">
          <span>Samples</span>
          <strong>{formatCount(activeWindowSamples.length)}</strong>
          <small>stored locally</small>
        </div>
        <div className="capture-stat">
          <span>Sessions</span>
          <strong>{formatCount(activeWindowSessions.length)}</strong>
          <small>{formatCount(unclassifiedSessionCount)} ready for AI classification</small>
        </div>
        <div className="capture-stat">
          <span>Visual context</span>
          <strong>{formatCount(visualContextInsights.length)}</strong>
          <small>derived insights, raw images deleted</small>
        </div>
      </div>
      {captureError && <p className="capture-error">{captureError}</p>}
      {visualContextStatus === "capturing" && <p className="capture-note">Visual context capture is deriving a local insight.</p>}
      {visualContextError && <p className="capture-error">{visualContextError}</p>}
      {latestSessionSummaries.length > 0 && (
        <div className="session-list">
          {latestSessionSummaries.map((session, index) => (
            <div key={`${session.app_name}-${index}`}>
              <span>{session.app_name}</span>
              <strong>{formatDurationMinutes(session.duration_minutes)}</strong>
              <small>
                {session.window_title ?? "Window title unavailable"}
                {session.session_count > 1 ? ` · ${session.session_count} session fragments combined` : ""}
              </small>
            </div>
          ))}
        </div>
      )}
      {visualContextInsights.length > 0 && (
        <div className="session-list">
          {visualContextInsights.slice(-3).reverse().map((insight) => (
            <div key={insight.insight_id}>
              <span>{insight.visible_tool ?? insight.app_name}</span>
              <strong title="How confident this derived visual-context insight is">
                {Number.isFinite(insight.confidence) ? Math.round(insight.confidence * 100) : 0}% confidence
              </strong>
              <small>{insight.activity_summary}</small>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
